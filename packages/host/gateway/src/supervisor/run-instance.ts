/**
 * Parent side of `zhin runtime start`: runs the instance under an {@link InstanceSupervisor} until it
 * stops for good (signal, clean exit, or crash without restart).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { INSTANCE_CHILD_ENV } from '@zhin.js/host-http/bridge';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { StartOptions } from '@zhin.js/runtime';
import { isNodeVersionSupported, NODE_ENGINES_HINT } from '../project/node-requirements.js';
import { InstanceSupervisor, type InstanceStatus } from './instance-supervisor.js';
import type { InstanceLogOptions } from './instance-logs.js';

const DISABLE_EXPERIMENTAL_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
const NODE_LOADER_OPTIONS = new Set([
  '--conditions',
  '--experimental-loader',
  '--import',
  '--loader',
  '--require',
  '-C',
  '-r',
]);

/** Default daemon log file (ADR 0054 §3). */
export function defaultInstanceLogFile(root: string): string {
  return join(root, '.zhin', 'logs', 'instance.log');
}

/** Whether this process is the supervised instance child rather than the supervisor. */
export function isSupervisedInstanceProcess(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return Boolean(environment[INSTANCE_CHILD_ENV]);
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

export interface RunSupervisedInstanceOptions {
  readonly root: string;
  readonly options: StartOptions;
  /** Executable script the child runs; defaults to `process.argv[1]` (the `zhin` CLI). */
  readonly entry?: string;
  /** Arguments after the entry; defaults to `process.argv.slice(2)`. */
  readonly args?: readonly string[];
  readonly logs?: Omit<InstanceLogOptions, 'file'>;
  /**
   * Attaches a component (the gateway HTTP server) to the supervisor before the instance starts;
   * closed when the run ends. Its `keepAlive()` keeps the run going while it owns the instance's
   * lifecycle (a Console stop, a dependency transaction).
   */
  readonly attach?: (supervisor: InstanceSupervisor) => Promise<SupervisedAttachment>;
}

export interface SupervisedAttachment {
  /** True while a stopped / crashed instance must not end the run. */
  keepAlive?(): boolean;
  close(): Promise<void>;
}

const KEEP_ALIVE_POLL_MS = 500;

/**
 * Runs the instance under supervision and resolves with the exit code this process should use.
 * Foreground runs share the terminal (`inherit`) and do not restart crashes; `--daemon` captures
 * output into a rotated log file and restarts crashes with storm protection; `--once` never restarts.
 */
export async function runSupervisedInstance(input: RunSupervisedInstanceOptions): Promise<number> {
  if (!isNodeVersionSupported()) {
    throw new Error(`zhin runtime start requires Node ${NODE_ENGINES_HINT}; found ${process.versions.node}`);
  }
  const entry = input.entry ?? process.argv[1];
  if (!entry) throw new Error('Cannot determine the zhin runtime executable path');
  const { root, options } = input;
  const logger = getLogger('runtime');
  const pidFile = join(root, '.zhin.pid');
  const logFile = options.daemon ? (options.logFile ?? defaultInstanceLogFile(root)) : undefined;
  if (logFile) await mkdir(dirname(logFile), { recursive: true });

  const supervisor = new InstanceSupervisor({
    spawn: {
      command: process.execPath,
      args: [...supervisedNodeArguments(), entry, ...(input.args ?? process.argv.slice(2))],
      cwd: root,
    },
    output: options.daemon ? 'pipe' : 'inherit',
    logs: { ...input.logs, file: logFile ?? false },
    restart: {
      onCrash: options.daemon && !options.once,
      onRequest: !options.once,
    },
  });

  if (options.daemon) {
    writeFileSync(pidFile, String(process.pid));
    logger.info(formatCompact({
      op: 'daemon_start', pid: process.pid, log: logFile,
      hint: `stop: zhin stop 或 kill -TERM ${process.pid}`,
    }));
  }
  supervisor.on('failure', (failure) => {
    logger.warn(formatCompact({ op: 'instance_failure', reason: failure.reason, message: failure.message }));
  });
  supervisor.on('restart-request', (request) => {
    logger.info(formatCompact({ op: 'instance_restart_request', reason: request.reason }));
  });

  let interrupted = false;
  const onSignal = (): void => {
    // A second signal kills the instance without waiting for its graceful stop.
    const force = interrupted;
    interrupted = true;
    void supervisor.stop({ reason: 'signal', force });
  };
  const onSighup = (): void => { if (!options.daemon) onSignal(); };
  const onExit = (): void => {
    supervisor.dispose();
    removePidFile();
  };
  const removePidFile = (): void => {
    if (!options.daemon) return;
    try {
      if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) rmSync(pidFile, { force: true });
    } catch { /* already gone */ }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSighup);
  process.on('exit', onExit);
  let attachment: SupervisedAttachment | undefined;
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  try {
    attachment = await input.attach?.(supervisor);
    const ended = (): boolean => (supervisor.state === 'stopped' || supervisor.state === 'crashed')
      && (interrupted || attachment?.keepAlive?.() !== true);
    const settled = new Promise<InstanceStatus>((resolve) => {
      const check = (): void => {
        if (ended()) resolve(supervisor.status());
      };
      supervisor.on('state', check);
      if (attachment?.keepAlive) {
        keepAliveTimer = setInterval(check, KEEP_ALIVE_POLL_MS);
        keepAliveTimer.unref?.();
      }
    });
    await supervisor.start().catch(() => undefined);
    const status = ended() ? supervisor.status() : await settled;
    if (interrupted) return status.lastExitCode ?? 130;
    if (status.state === 'crashed') return status.lastExitCode || 1;
    return status.lastExitCode ?? 0;
  } finally {
    clearInterval(keepAliveTimer);
    await attachment?.close().catch((error: unknown) => {
      logger.warn(formatCompact({ op: 'gateway_close_failed', error: error instanceof Error ? error.message : String(error) }));
    });
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSighup);
    process.off('exit', onExit);
    supervisor.dispose();
    removePidFile();
  }
}
