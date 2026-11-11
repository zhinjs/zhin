/**
 * Instance supervisor (ADR 0054 §3 / §5): spawns the Zhin instance with an IPC control channel
 * (`serialization: 'advanced'`), waits for its `ready` handshake, stops it with a graceful
 * `shutdown` message before escalating to SIGTERM / SIGKILL, restarts it on `restart-request`
 * and on crashes with backoff and storm protection, and captures its stdout / stderr.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  INSTANCE_BRIDGE_PROTOCOL_VERSION,
  INSTANCE_CHILD_ENV,
  parseInstanceMessage,
  type GatewayShutdownMessage,
  type InstanceReadyPayload,
  type InstanceRestartRequestPayload,
} from '@zhin.js/host-http/bridge';
import { DEFAULT_SHUTDOWN_BUDGET_MS } from '@zhin.js/runtime';
import { InstanceLogCollector, type InstanceLogLine, type InstanceLogOptions } from './instance-logs.js';

export type InstanceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'backoff' | 'crashed';

export type InstanceFailureReason =
  | 'exit'
  | 'spawn-error'
  | 'ready-timeout'
  | 'protocol-mismatch'
  | 'restart-storm';

export interface InstanceFailure {
  readonly reason: InstanceFailureReason;
  readonly message: string;
  readonly at: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Last captured log lines before the failure (empty with inherited output). */
  readonly logTail: readonly string[];
}

export interface InstanceStatus {
  readonly state: InstanceState;
  readonly pid?: number;
  /** Epoch ms of the current child's `ready`. */
  readonly startedAt?: number;
  /** Runtime generation reported by the instance in `ready`. */
  readonly generation?: number;
  /** Protocol version reported by the instance in `ready`. */
  readonly protocolVersion?: number;
  readonly lastExitCode: number | null;
  readonly lastExitSignal: NodeJS.Signals | null;
  readonly lastFailure?: InstanceFailure;
  /** Automatic restarts (crash or requested) inside the current storm window. */
  readonly recentRestarts: number;
}

export interface InstanceSpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Child environment; defaults to `process.env`. {@link INSTANCE_CHILD_ENV} is always set. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface InstanceRestartPolicy {
  /** Restart crashed instances automatically. Default true. */
  readonly onCrash?: boolean;
  /** Honour `restart-request` from the instance. Default true. */
  readonly onRequest?: boolean;
  /** Automatic restarts allowed per window before the instance stays `crashed`. Default 10. */
  readonly maxRestarts?: number;
  /** Storm window. Default 60 s. */
  readonly windowMs?: number;
  /** Delay before an automatic restart (`backoff` state). Default 3 s. */
  readonly delayMs?: number;
}

export interface InstanceSupervisorOptions {
  readonly spawn: InstanceSpawnSpec;
  /** `pipe` captures stdout / stderr into {@link InstanceSupervisor.logs}; `inherit` shares the terminal. */
  readonly output?: 'pipe' | 'inherit';
  readonly logs?: InstanceLogOptions;
  readonly readyTimeoutMs?: number;
  /** Budget announced in `shutdown`; SIGTERM follows when the child has not exited after it. */
  readonly shutdownBudgetMs?: number;
  /** Time between SIGTERM and SIGKILL. */
  readonly killGraceMs?: number;
  readonly restart?: InstanceRestartPolicy;
  /** Protocol versions this supervisor accepts. Default: only {@link INSTANCE_BRIDGE_PROTOCOL_VERSION}. */
  readonly acceptedProtocolVersions?: readonly number[];
}

export interface InstanceStopOptions {
  /** Time to wait after `shutdown` before SIGTERM. Default: shutdown budget + 1 s. */
  readonly timeoutMs?: number;
  readonly reason?: string;
  /** Kill immediately with SIGKILL (also escalates a stop already in progress). */
  readonly force?: boolean;
}

export interface InstanceExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** The exit was requested by the supervisor (stop / restart). */
  readonly expected: boolean;
}

export interface InstanceSupervisorEvents {
  state: [InstanceStatus];
  ready: [InstanceReadyPayload];
  exit: [InstanceExit];
  'restart-request': [InstanceRestartRequestPayload];
  failure: [InstanceFailure];
  log: [InstanceLogLine];
}

export const DEFAULT_INSTANCE_READY_TIMEOUT_MS = 60_000;
export const DEFAULT_INSTANCE_KILL_GRACE_MS = 2_000;
/** Storm guard: 10 automatic restarts per minute, 3 s apart (ADR 0054 §5). */
export const MAX_RESTARTS_PER_WINDOW = 10;
export const RESTART_WINDOW_MS = 60_000;
export const RESTART_DELAY_MS = 3_000;
const FAILURE_LOG_TAIL_LINES = 50;
const STDIO_DRAIN_MS = 250;

export class InstanceProtocolMismatchError extends Error {
  readonly code = 'ZHIN_INSTANCE_PROTOCOL_MISMATCH';
  constructor(readonly instanceVersion: number, readonly accepted: readonly number[]) {
    super(`Instance protocol version ${instanceVersion} is not supported by this gateway (accepts ${accepted.join(', ')}); upgrade zhin.js and @zhin.js/gateway together`);
    this.name = 'InstanceProtocolMismatchError';
  }
}

export class InstanceStartError extends Error {
  readonly code = 'ZHIN_INSTANCE_START_FAILED';
  constructor(readonly failure: InstanceFailure) {
    super(failure.message);
    this.name = 'InstanceStartError';
  }
}

interface ChildRecord {
  readonly process: ChildProcess;
  readonly exited: Promise<InstanceExit>;
  resolveExited(exit: InstanceExit): void;
  ready: boolean;
  /** Set when the supervisor itself ended this child (stop, restart, ready failure). */
  terminating: boolean;
  failure?: InstanceFailure;
  readyTimer?: ReturnType<typeof setTimeout>;
  termTimer?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
  settleStart?: (error?: Error) => void;
  /** {@link InstanceSupervisor.#stopIntent} when a requested restart began. */
  restartIntent?: number;
}

export class InstanceSupervisor extends EventEmitter<InstanceSupervisorEvents> {
  readonly logs: InstanceLogCollector;
  readonly #options: InstanceSupervisorOptions;
  readonly #accepted: readonly number[];
  #state: InstanceState = 'stopped';
  #child: ChildRecord | undefined;
  #starting: Promise<void> | undefined;
  #stopping: Promise<void> | undefined;
  #backoffTimer: ReturnType<typeof setTimeout> | undefined;
  #restartTimes: number[] = [];
  #ready: InstanceReadyPayload | undefined;
  #startedAt: number | undefined;
  #lastExit: InstanceExit | undefined;
  #lastFailure: InstanceFailure | undefined;
  /** Bumped by every stop(); a pending automatic restart only proceeds when it is unchanged. */
  #stopIntent = 0;

  constructor(options: InstanceSupervisorOptions) {
    super();
    this.#options = options;
    this.#accepted = Object.freeze([...(options.acceptedProtocolVersions ?? [INSTANCE_BRIDGE_PROTOCOL_VERSION])]);
    this.logs = new InstanceLogCollector(options.logs);
    this.logs.subscribe((line) => { this.emit('log', line); });
  }

  get state(): InstanceState { return this.#state; }

  status(): InstanceStatus {
    const child = this.#child;
    return Object.freeze({
      state: this.#state,
      ...(child?.process.pid !== undefined ? { pid: child.process.pid } : {}),
      ...(this.#startedAt !== undefined && this.#state === 'running' ? { startedAt: this.#startedAt } : {}),
      ...(this.#ready?.generation !== undefined ? { generation: this.#ready.generation } : {}),
      ...(this.#ready ? { protocolVersion: this.#ready.version } : {}),
      lastExitCode: this.#lastExit?.code ?? null,
      lastExitSignal: this.#lastExit?.signal ?? null,
      ...(this.#lastFailure ? { lastFailure: this.#lastFailure } : {}),
      recentRestarts: this.#recentRestarts(Date.now()).length,
    });
  }

  /**
   * Starts the instance and resolves on its `ready`. A manual start resets the storm window.
   * Rejects with {@link InstanceStartError} / {@link InstanceProtocolMismatchError} when this
   * attempt fails; automatic restarts after a crash still follow the restart policy.
   */
  async start(): Promise<void> {
    if (this.#stopping) await this.#stopping.catch(() => undefined);
    // A child that is being replaced (requested restart, ready failure) must be gone first.
    if (this.#child?.terminating) await this.#child.exited;
    if (this.#state === 'running') return;
    if (this.#starting) return this.#starting;
    this.#clearBackoff();
    this.#restartTimes = [];
    return this.#spawn();
  }

  /** Graceful `shutdown`, then SIGTERM after `timeoutMs`, then SIGKILL after the kill grace. */
  stop(options: InstanceStopOptions = {}): Promise<void> {
    this.#stopIntent += 1;
    this.#clearBackoff();
    const child = this.#child;
    if (!child) {
      if (this.#state === 'backoff' || this.#state === 'crashed') this.#setState('stopped');
      return this.#stopping ?? Promise.resolve();
    }
    if (options.force) child.process.kill('SIGKILL');
    if (this.#stopping) return this.#stopping;
    this.#setState('stopping');
    const stopping = this.#terminate(child, options.reason ?? 'stop', options.timeoutMs).then(() => undefined);
    this.#stopping = stopping.finally(() => { this.#stopping = undefined; });
    return this.#stopping;
  }

  /** Manual restart: stop gracefully, then start (not counted by the storm guard). */
  async restart(options: Omit<InstanceStopOptions, 'force'> = {}): Promise<void> {
    await this.stop({ ...options, reason: options.reason ?? 'restart' });
    await this.start();
  }

  /** Releases timers and the log file; kills a child that is still running. */
  dispose(): void {
    this.#clearBackoff();
    try { this.#child?.process.kill('SIGKILL'); } catch { /* already gone */ }
    this.logs.close();
    this.removeAllListeners();
  }

  #spawn(): Promise<void> {
    const { spawn: spec } = this.#options;
    const output = this.#options.output ?? 'pipe';
    this.#ready = undefined;
    this.#startedAt = undefined;
    this.#setState('starting');
    let processHandle: ChildProcess;
    let resolveExited!: (exit: InstanceExit) => void;
    const exited = new Promise<InstanceExit>((resolve) => { resolveExited = resolve; });
    try {
      processHandle = spawn(spec.command, [...spec.args], {
        cwd: spec.cwd,
        env: { ...(spec.env ?? process.env), [INSTANCE_CHILD_ENV]: '1' },
        stdio: ['ignore', output, output, 'ipc'],
        serialization: 'advanced',
        windowsHide: true,
      });
    } catch (error) {
      const failure = this.#failure('spawn-error', `Failed to spawn the instance: ${errorMessage(error)}`, null, null);
      this.#afterFailedChild(failure, false);
      return Promise.reject(new InstanceStartError(failure));
    }
    const child: ChildRecord = { process: processHandle, exited, resolveExited, ready: false, terminating: false };
    this.#child = child;
    if (output === 'pipe') {
      if (processHandle.stdout) this.logs.attach(processHandle.stdout, 'stdout');
      if (processHandle.stderr) this.logs.attach(processHandle.stderr, 'stderr');
    }
    const starting = new Promise<void>((resolve, reject) => {
      child.settleStart = (error) => {
        child.settleStart = undefined;
        if (error) reject(error);
        else resolve();
      };
    });
    const guarded: Promise<void> = starting.finally(() => {
      if (this.#starting === guarded) this.#starting = undefined;
    });
    this.#starting = guarded;
    // Callers may ignore automatic-restart attempts; never leave them unhandled.
    guarded.catch(() => undefined);

    const readyTimeoutMs = this.#options.readyTimeoutMs ?? DEFAULT_INSTANCE_READY_TIMEOUT_MS;
    child.readyTimer = setTimeout(() => {
      if (child.ready || this.#child !== child) return;
      const failure = this.#failure('ready-timeout', `Instance did not report ready within ${readyTimeoutMs} ms`, null, null);
      child.failure = failure;
      child.settleStart?.(new InstanceStartError(failure));
      void this.#terminate(child, 'ready-timeout');
    }, readyTimeoutMs);

    processHandle.on('message', (raw) => { this.#onMessage(child, raw); });
    processHandle.once('error', (error) => {
      // Spawn failures (ENOENT, EACCES) emit `error` and no `exit`.
      if (processHandle.pid !== undefined && processHandle.exitCode === null && processHandle.signalCode === null) return;
      child.failure ??= this.#failure('spawn-error', `Failed to spawn the instance: ${error.message}`, null, null);
      this.#onExit(child, null, null);
    });
    // Let stdout / stderr drain so the log tail is complete, but do not wait on `close`: a
    // grandchild that inherited the pipes could hold them open long after the instance died.
    const drained = Promise.all([processHandle.stdout, processHandle.stderr].map((stream) => (
      stream && !stream.readableEnded
        ? new Promise<void>((resolve) => { stream.once('end', resolve); stream.once('close', resolve); })
        : undefined
    )));
    processHandle.once('exit', (code, signal) => {
      const settle = (): void => {
        clearTimeout(timer);
        this.#onExit(child, code, signal);
      };
      const timer = setTimeout(settle, STDIO_DRAIN_MS);
      void drained.then(settle);
    });
    return guarded;
  }

  #onMessage(child: ChildRecord, raw: unknown): void {
    if (this.#child !== child) return;
    const message = parseInstanceMessage(raw);
    if (!message) return;
    if (message.type === 'ready') {
      if (child.ready || child.terminating) return;
      clearTimeout(child.readyTimer);
      if (!this.#accepted.includes(message.payload.version)) {
        const error = new InstanceProtocolMismatchError(message.payload.version, this.#accepted);
        child.failure = this.#failure('protocol-mismatch', error.message, null, null);
        child.settleStart?.(error);
        void this.#terminate(child, 'protocol-mismatch');
        return;
      }
      child.ready = true;
      this.#ready = message.payload;
      this.#startedAt = Date.now();
      this.#setState('running');
      this.emit('ready', message.payload);
      child.settleStart?.();
      return;
    }
    // restart-request
    this.emit('restart-request', message.payload);
    if (this.#options.restart?.onRequest === false) return;
    if (!child.ready || child.terminating || this.#state !== 'running') return;
    if (!this.#admitRestart()) {
      child.failure = this.#failure('restart-storm', `Too many restarts within ${this.#windowMs()} ms; the instance stays stopped`, null, null);
      void this.#terminate(child, 'restart-storm');
      return;
    }
    // Respawned straight from the exit handler, so observers never see a transient `stopped`.
    child.restartIntent = this.#stopIntent;
    this.#setState('stopping');
    void this.#terminate(child, `restart:${message.payload.reason}`);
  }

  #onExit(child: ChildRecord, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#child !== child) return;
    clearTimeout(child.readyTimer);
    clearTimeout(child.termTimer);
    clearTimeout(child.killTimer);
    this.logs.flush();
    this.#child = undefined;
    const expected = child.terminating;
    const exit: InstanceExit = Object.freeze({ code, signal, expected });
    this.#lastExit = exit;
    this.emit('exit', exit);
    if (child.failure) {
      const failure = { ...child.failure, exitCode: code, signal };
      this.#afterFailedChild(Object.freeze(failure), child.failure.reason === 'ready-timeout');
      child.settleStart?.(new InstanceStartError(failure));
    } else if (child.restartIntent !== undefined && child.restartIntent === this.#stopIntent) {
      child.resolveExited(exit);
      void this.#spawn().catch(() => undefined);
      return;
    } else if (expected || (code === 0 && signal === null)) {
      // Requested stop, or the instance ended on its own cleanly (e.g. `--once`).
      this.#setState('stopped');
      child.settleStart?.(new InstanceStartError(this.#failure('exit', 'Instance exited before it was ready', code, signal)));
    } else {
      const failure = this.#failure('exit', `Instance exited unexpectedly (code ${code ?? 'none'}${signal ? `, signal ${signal}` : ''})`, code, signal);
      this.#afterFailedChild(failure, true);
      child.settleStart?.(new InstanceStartError(failure));
    }
    child.resolveExited(exit);
  }

  /** Records a failure and either schedules a restart (`backoff`) or stays `crashed`. */
  #afterFailedChild(failure: InstanceFailure, restartable: boolean): void {
    this.#lastFailure = failure;
    this.emit('failure', failure);
    if (restartable && this.#options.restart?.onCrash !== false && this.#admitRestart()) {
      this.#setState('backoff');
      this.#backoffTimer = setTimeout(() => {
        this.#backoffTimer = undefined;
        if (this.#state === 'backoff') void this.#spawn().catch(() => undefined);
      }, this.#options.restart?.delayMs ?? RESTART_DELAY_MS);
      return;
    }
    if (restartable && this.#options.restart?.onCrash !== false) {
      this.#lastFailure = Object.freeze({
        ...failure,
        reason: 'restart-storm' as const,
        message: `${failure.message}; too many restarts within ${this.#windowMs()} ms, the instance stays crashed`,
      });
      this.emit('failure', this.#lastFailure);
    }
    this.#setState('crashed');
  }

  #terminate(child: ChildRecord, reason: string, timeoutMs?: number): Promise<InstanceExit> {
    if (child.terminating) return child.exited;
    child.terminating = true;
    clearTimeout(child.readyTimer);
    const budgetMs = this.#options.shutdownBudgetMs ?? DEFAULT_SHUTDOWN_BUDGET_MS;
    const waitMs = timeoutMs ?? budgetMs + 1_000;
    const killGraceMs = this.#options.killGraceMs ?? DEFAULT_INSTANCE_KILL_GRACE_MS;
    const escalate = (): void => {
      if (this.#child !== child) return;
      try { child.process.kill('SIGTERM'); } catch { /* already gone */ }
      child.killTimer = setTimeout(() => {
        if (this.#child !== child) return;
        try { child.process.kill('SIGKILL'); } catch { /* already gone */ }
      }, killGraceMs);
    };
    if (child.process.connected) {
      const message: GatewayShutdownMessage = { type: 'shutdown', payload: { reason, budgetMs } };
      try { child.process.send(message, () => undefined); } catch { /* channel closed */ }
      child.termTimer = setTimeout(escalate, waitMs);
    } else {
      escalate();
    }
    return child.exited;
  }

  #admitRestart(now = Date.now()): boolean {
    const recent = this.#recentRestarts(now);
    if (recent.length >= (this.#options.restart?.maxRestarts ?? MAX_RESTARTS_PER_WINDOW)) {
      this.#restartTimes = recent;
      return false;
    }
    this.#restartTimes = [...recent, now];
    return true;
  }

  #recentRestarts(now: number): number[] {
    const windowMs = this.#windowMs();
    return this.#restartTimes.filter((time) => now - time < windowMs);
  }

  #windowMs(): number { return this.#options.restart?.windowMs ?? RESTART_WINDOW_MS; }

  #failure(reason: InstanceFailureReason, message: string, exitCode: number | null, signal: NodeJS.Signals | null): InstanceFailure {
    return Object.freeze({
      reason,
      message,
      at: Date.now(),
      exitCode,
      signal,
      logTail: Object.freeze(this.logs.tail(FAILURE_LOG_TAIL_LINES).map((line) => line.line)),
    });
  }

  #clearBackoff(): void {
    if (this.#backoffTimer) clearTimeout(this.#backoffTimer);
    this.#backoffTimer = undefined;
  }

  #setState(state: InstanceState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.emit('state', this.status());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
