import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { supportsNativeTypeScript } from '@zhin.js/runtime';
import { DEFAULT_SHUTDOWN_BUDGET_MS } from '../process-lifecycle.js';
import type { StartOptions } from './options.js';

const DISABLE_EXPERIMENTAL_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
const RESPAWN_WINDOW_MS = 60_000;
const NODE_LOADER_OPTIONS = new Set([
  '--conditions',
  '--experimental-loader',
  '--import',
  '--loader',
  '--require',
  '-C',
  '-r',
]);

export const processRestartExitCode = 75;
/** Storm guard parity with the `zhin start` daemon: 10 restarts/minute, 3s delay. */
export const MAX_RESPAWNS_PER_MINUTE = 10;
export const RESPAWN_DELAY_MS = 3_000;
/** Gives the Runtime its complete shutdown budget before fencing leaked handles. */
export const SUPERVISOR_CHILD_EXIT_GRACE_MS = DEFAULT_SHUTDOWN_BUDGET_MS + 1_000;

export interface RespawnPlan {
  readonly respawn: boolean;
  readonly attempts: readonly number[];
}

export function planRespawn(
  exitCode: number | null,
  once: boolean,
  daemon: boolean,
  attempts: readonly number[],
  now = Date.now(),
): RespawnPlan {
  if (once) return Object.freeze({ respawn: false, attempts });
  const shouldRespawn = exitCode === processRestartExitCode || (daemon && exitCode !== 0);
  if (!shouldRespawn) return Object.freeze({ respawn: false, attempts });
  const recent = attempts.filter((timestamp) => now - timestamp < RESPAWN_WINDOW_MS);
  if (recent.length >= MAX_RESPAWNS_PER_MINUTE) {
    return Object.freeze({ respawn: false, attempts: recent });
  }
  return Object.freeze({ respawn: true, attempts: Object.freeze([...recent, now]) });
}

/** Preserve process loader configuration when the supervisor creates a child. */
export function supervisedNodeArguments(
  execArguments: readonly string[] = process.execArgv,
): readonly string[] {
  const inherited: string[] = [];
  for (let index = 0; index < execArguments.length; index += 1) {
    const argument = execArguments[index]!;
    const option = argument.split('=', 1)[0]!;
    if (!NODE_LOADER_OPTIONS.has(option)) continue;
    inherited.push(argument);
    if (argument === option) {
      const value = execArguments[index + 1];
      if (value !== undefined) {
        inherited.push(value);
        index += 1;
      }
    }
  }
  return Object.freeze([
    ...inherited,
    '--experimental-strip-types',
    DISABLE_EXPERIMENTAL_WARNING_FLAG,
  ]);
}

/** Owns the parent process state for native-TypeScript child supervision. */
export class NativeTypeScriptSupervisor {
  readonly #root: string;
  readonly #options: StartOptions;
  readonly #pidFile: string;
  #attempts: readonly number[] = [];
  #interrupted = false;
  #activeChild: ChildProcess | undefined;
  #forceChildExitTimer: ReturnType<typeof setTimeout> | undefined;
  #logFileDescriptor: number | undefined;

  constructor(root: string, options: StartOptions) {
    this.#root = root;
    this.#options = options;
    this.#pidFile = join(root, '.zhin.pid');
  }

  async runIfRequired(): Promise<boolean> {
    if (process.env.ZHIN_RUNTIME_CHILD) return false;
    if (supportsNativeTypeScript() && !this.#options.daemon) return false;
    this.#assertSupportedNodeVersion();
    const entry = process.argv[1];
    if (!entry) throw new Error('Cannot determine the zhin runtime executable path');

    const stdio = await this.#prepareStandardIo();
    process.on('SIGINT', this.#onSigint);
    process.on('SIGTERM', this.#onSigterm);
    process.on('SIGHUP', this.#onSighup);
    process.on('exit', this.#onExit);
    try {
      return await this.#runLoop(entry, stdio);
    } finally {
      this.#dispose();
    }
  }

  async #runLoop(
    entry: string,
    stdio: 'inherit' | ['ignore', number, number],
  ): Promise<true> {
    for (;;) {
      const child = spawn(process.execPath, [
        ...supervisedNodeArguments(),
        entry,
        ...process.argv.slice(2),
      ], {
        stdio,
        env: {
          ...process.env,
          ZHIN_SUPERVISOR_PID: String(process.pid),
          ZHIN_RUNTIME_CHILD: '1',
        },
      });
      this.#activeChild = child;
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => resolve({ code, signal }));
        },
      );
      this.#clearChildState();
      if (this.#interrupted) {
        process.exitCode = result.code ?? 130;
        return true;
      }
      if (result.signal && !this.#options.daemon) {
        throw new Error(`Native TypeScript child exited from ${result.signal}`);
      }
      const plan = planRespawn(
        result.code ?? 1,
        this.#options.once,
        this.#options.daemon,
        this.#attempts,
      );
      this.#attempts = plan.attempts;
      if (!plan.respawn) {
        process.exitCode = result.code ?? 1;
        return true;
      }
      if (this.#options.daemon) {
        getLogger('runtime').warn(formatCompact({
          op: 'daemon_respawn',
          code: result.code,
          signal: result.signal,
          attempts: this.#attempts.length,
        }));
      }
      await new Promise((resolve) => { setTimeout(resolve, RESPAWN_DELAY_MS); });
      if (this.#interrupted) {
        process.exitCode = 130;
        return true;
      }
    }
  }

  async #prepareStandardIo(): Promise<'inherit' | ['ignore', number, number]> {
    if (!this.#options.daemon) return 'inherit';
    const logFile = this.#options.logFile ?? join(this.#root, '.zhin', 'runtime.log');
    await mkdir(dirname(logFile), { recursive: true });
    this.#logFileDescriptor = openSync(logFile, 'a');
    writeFileSync(this.#pidFile, String(process.pid));
    getLogger('runtime').info(formatCompact({
      op: 'daemon_start', pid: process.pid, log: logFile,
      hint: `stop: zhin stop 或 kill -TERM ${process.pid}`,
    }));
    return ['ignore', this.#logFileDescriptor, this.#logFileDescriptor];
  }

  #forward(signal: NodeJS.Signals): void {
    this.#interrupted = true;
    const child = this.#activeChild;
    if (!child) return;
    child.kill(signal);
    this.#forceChildExitTimer ??= setTimeout(() => {
      if (this.#activeChild === child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, SUPERVISOR_CHILD_EXIT_GRACE_MS);
  }

  readonly #onSigint = (): void => { this.#forward('SIGINT'); };
  readonly #onSigterm = (): void => { this.#forward('SIGTERM'); };
  readonly #onSighup = (): void => { this.#forward('SIGHUP'); };
  readonly #onExit = (): void => {
    try { this.#activeChild?.kill('SIGTERM'); } catch { /* already gone */ }
    this.#removePidFile();
  };

  #clearChildState(): void {
    if (this.#forceChildExitTimer) clearTimeout(this.#forceChildExitTimer);
    this.#forceChildExitTimer = undefined;
    this.#activeChild = undefined;
  }

  #dispose(): void {
    this.#clearChildState();
    this.#removePidFile();
    process.off('SIGINT', this.#onSigint);
    process.off('SIGTERM', this.#onSigterm);
    process.off('SIGHUP', this.#onSighup);
    process.off('exit', this.#onExit);
    if (this.#logFileDescriptor !== undefined) closeSync(this.#logFileDescriptor);
    this.#logFileDescriptor = undefined;
  }

  #removePidFile(): void {
    if (!this.#options.daemon) return;
    try {
      if (readFileSync(this.#pidFile, 'utf8').trim() === String(process.pid)) {
        rmSync(this.#pidFile, { force: true });
      }
    } catch { /* already gone */ }
  }

  #assertSupportedNodeVersion(): void {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 6)) {
      throw new Error(
        `zhin runtime start requires Node >=22.6.0 for native TypeScript; found ${process.versions.node}`,
      );
    }
  }
}

/** Poll parent liveness; when the supervisor (or any parent) is gone, shut down. */
export function startSupervisorWatchdog(onOrphaned: () => void): NodeJS.Timeout {
  const supervisorPid = Number(process.env.ZHIN_SUPERVISOR_PID ?? '');
  const logger = getLogger('runtime');
  return setInterval(() => {
    if (Number.isInteger(supervisorPid) && supervisorPid > 0) {
      try {
        process.kill(supervisorPid, 0);
        return;
      } catch {
        // ESRCH — supervisor is gone
      }
    } else if (process.ppid && process.ppid !== 1) {
      return;
    }
    logger.error(formatCompact({
      op: 'orphan_shutdown',
      reason: Number.isInteger(supervisorPid) && supervisorPid > 0
        ? `supervisor ${supervisorPid} exited`
        : 'reparented to init (parent died)',
    }));
    onOrphaned();
  }, 2_000).unref();
}
