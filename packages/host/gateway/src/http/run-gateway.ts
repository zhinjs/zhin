/**
 * The gateway process (ADR 0054 §1 / §5 / §6): `zhin start` / `zhin runtime start` / `pnpm dev`.
 * Long-lived: the instance crashing, entering `crashed` after a restart storm, or being stopped
 * from the Console / CLI does not end it. It ends on SIGINT / SIGTERM (both processes stop) or
 * `gateway.shutdown` on the local control socket. Only `--once` (CI) still ends with the instance.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { REMOTE_CONSOLE_ORIGIN, type ResolvedHttpConfig } from '@zhin.js/host-http';
import { GATEWAY_SOCKET_ENV } from '@zhin.js/host-http/bridge';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { instanceStatus } from '../packages/rpc.js';
import { createLocalRpcHandler } from '../local/handler.js';
import { LocalControlServer, LocalSocketError, probeLocalSocket } from '../local/local-socket.js';
import { gatewayInfoFile, gatewaySocketPath, isNamedPipe } from '../local/paths.js';
import type { LocalGatewayInfo, LocalGatewayInfoResult } from '../local/protocol.js';
import { readGatewayInfo, removeGatewayInfo, writeGatewayInfo } from '../local/state-file.js';
import { isNodeVersionSupported, NODE_ENGINES_HINT } from '../project/node-requirements.js';
import { InstanceSupervisor, type InstanceRestartPolicy, type InstanceStatus } from '../supervisor/instance-supervisor.js';
import { defaultInstanceLogFile, supervisedNodeArguments, type RunSupervisedInstanceOptions } from '../supervisor/run-instance.js';
import { captureTerminalState, isForegroundProcessGroup } from '../supervisor/terminal-state.js';
import { loadGatewaySettings, startGateway, type RunningGateway } from './start-gateway.js';

/** Set on the instance when its output is echoed to an interactive terminal (TTY-style logging). */
export const INSTANCE_INTERACTIVE_ENV = 'ZHIN_INSTANCE_INTERACTIVE';

export interface RunGatewayOptions extends Omit<RunSupervisedInstanceOptions, 'attach'> {
  /** Overrides the project's `http` block (tests). */
  readonly http?: ResolvedHttpConfig;
  /** Local control socket; `false` disables it. Default: `.zhin/gateway.sock` / the named pipe. */
  readonly localSocket?: false | { readonly path?: string; readonly uid?: () => number | undefined };
  /** Echo instance output to this process. Default: not in `--daemon` mode. */
  readonly echo?: boolean;
  /** Handle SIGINT / SIGTERM / SIGHUP. Default true. */
  readonly signals?: boolean;
  /** Overrides the crash / storm policy (default: ADR 0054 §5, restarts off with `--once`). */
  readonly restart?: InstanceRestartPolicy;
  /** Called once the gateway serves HTTP and the local socket. */
  readonly onReady?: (gateway: RunningGatewayProcess) => void;
}

export interface RunningGatewayProcess {
  readonly gateway: RunningGateway;
  readonly info: LocalGatewayInfo;
  /** Ends the run (as `gateway.shutdown` does). */
  shutdown(exitCode?: number): void;
}

let cachedVersion: string | undefined;
/** `@zhin.js/gateway` version. */
export function gatewayVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    cachedVersion = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch { cachedVersion = '0.0.0'; }
  return cachedVersion;
}

/** Console link in the ADR 0053 format: `?apiBaseUrl=`, the token only after `#`. */
export function consoleLink(origin: string, token?: string): string {
  const url = `${REMOTE_CONSOLE_ORIGIN}/?apiBaseUrl=${encodeURIComponent(origin)}`;
  return token ? `${url}#token=${encodeURIComponent(token)}` : url;
}

/**
 * Whether the instance gets the gateway's stdin: a foreground gateway whose stdin is a TTY and
 * that is the terminal's foreground job (a background job's child reading the TTY gets SIGTTIN).
 */
export function foregroundStdin(
  daemon: boolean,
  stdin: { readonly isTTY?: boolean } = process.stdin,
  foregroundGroup: () => boolean = isForegroundProcessGroup,
): boolean {
  return !daemon && stdin.isTTY === true && foregroundGroup();
}

/**
 * The local control endpoint of this run. Windows named pipes get a fresh random name component
 * (Node cannot set a DACL on them; see `windowsPipeName`), so a second gateway on the project is
 * detected through the pipe the state file records instead of a name clash.
 */
async function localEndpoint(root: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  if (platform !== 'win32') return gatewaySocketPath(root, { platform });
  const recorded = await readGatewayInfo(root);
  if (recorded && isNamedPipe(recorded.socket) && await probeLocalSocket(recorded.socket).catch(() => 'live' as const) === 'live') {
    throw new LocalSocketError('in_use', `另一个网关正在使用 ${recorded.socket}`);
  }
  return gatewaySocketPath(root, { platform, nonce: randomBytes(8).toString('hex') });
}

/** Strips the `zhin runtime start` / `zhin start` prefix of the instance arguments. */
function startArguments(args: readonly string[]): readonly string[] {
  if (args[0] === 'runtime' && args[1] === 'start') return args.slice(2);
  if (args[0] === 'start') return args.slice(1);
  return args;
}

/** Runs the gateway until it is shut down; resolves with the exit code for this process. */
export async function runGateway(input: RunGatewayOptions): Promise<number> {
  if (!isNodeVersionSupported()) {
    throw new Error(`zhin start requires Node ${NODE_ENGINES_HINT}; found ${process.versions.node}`);
  }
  const entry = input.entry ?? process.argv[1];
  if (!entry) throw new Error('Cannot determine the zhin executable path');
  const { root, options } = input;
  const logger = getLogger('gateway');
  const args = [...(input.args ?? process.argv.slice(2))];
  const daemon = options.daemon;
  const echo = input.echo ?? !daemon;
  const interactive = echo && process.stdout.isTTY === true;
  const logFile = options.logFile ?? defaultInstanceLogFile(root);
  await mkdir(dirname(logFile), { recursive: true });
  const settings = await loadGatewaySettings(root);
  const socketPath = input.localSocket === false ? undefined : input.localSocket?.path ?? await localEndpoint(root);
  // Keyed proof the CLI checks before it talks to the endpoint (only in the 0600 state file).
  const handshakeKey = randomBytes(32).toString('hex');

  const shareTerminal = foregroundStdin(daemon);
  // The instance may leave the shared terminal raw / without echo when it exits or crashes.
  const terminal = shareTerminal ? captureTerminalState() : undefined;
  const supervisor = new InstanceSupervisor({
    ...(settings.readyTimeoutMs !== undefined ? { readyTimeoutMs: settings.readyTimeoutMs } : {}),
    spawn: {
      command: process.execPath,
      args: [...supervisedNodeArguments(), entry, ...args],
      cwd: root,
      env: {
        ...process.env,
        // The instance keeps the Agent's file / shell tools away from the owner endpoint.
        ...(socketPath ? { [GATEWAY_SOCKET_ENV]: socketPath } : {}),
        ...(interactive ? { [INSTANCE_INTERACTIVE_ENV]: '1', FORCE_COLOR: process.env.FORCE_COLOR ?? '1' } : {}),
      },
    },
    output: 'pipe',
    // Foreground on a TTY: the instance reads the terminal (terminal adapters); never in the background.
    input: shareTerminal ? 'inherit' : 'ignore',
    logs: { ...input.logs, file: logFile },
    // The gateway outlives the instance (ADR 0054 §5); `--once` is a single check run.
    restart: { onCrash: !options.once, onRequest: !options.once, ...input.restart },
  });
  if (echo) {
    supervisor.on('log', (line) => {
      (line.stream === 'stderr' ? process.stderr : process.stdout).write(`${line.line}\n`);
    });
  }
  supervisor.on('state', (status) => {
    if (terminal && (status.state === 'stopped' || status.state === 'crashed' || status.state === 'backoff')) terminal.restore();
    logger.info(formatCompact({ op: 'instance_state', state: status.state, ...(status.pid ? { pid: status.pid } : {}) }));
  });
  supervisor.on('failure', (failure) => {
    logger.warn(formatCompact({ op: 'instance_failure', reason: failure.reason, message: failure.message }));
  });
  supervisor.on('restart-request', (request) => {
    logger.info(formatCompact({ op: 'instance_restart_request', reason: request.reason }));
  });

  const control = socketPath
    ? await LocalControlServer.open({
      path: socketPath,
      handshakeKey,
      // No other gateway serves the project: a state file left by a dead one is stale.
      beforeListen: () => rm(gatewayInfoFile(root), { force: true }),
      ...(input.localSocket && input.localSocket.uid ? { uid: input.localSocket.uid } : {}),
    }).catch((error: unknown) => { supervisor.dispose(); throw error; })
    : undefined;

  let gateway: RunningGateway;
  try {
    gateway = await startGateway({
      projectRoot: root,
      environment: options.environment,
      ...(input.http ? { http: input.http } : {}),
      supervisor,
      transport: () => supervisor.transport,
      ...(settings.readyTimeoutMs !== undefined ? { readyTimeoutMs: settings.readyTimeoutMs } : {}),
    });
  } catch (error) {
    await control?.close();
    supervisor.dispose();
    throw error;
  }

  let resolveEnd!: (code: number) => void;
  const ended = new Promise<number>((resolve) => { resolveEnd = resolve; });
  let ending = false;
  const shutdown = (exitCode = 0): void => {
    if (ending) return;
    ending = true;
    logger.info(formatCompact({ op: 'gateway_stop' }));
    resolveEnd(exitCode);
  };

  const addresses = gateway.http.addresses;
  const info: LocalGatewayInfo = Object.freeze({
    pid: process.pid,
    ports: Object.freeze(addresses.map((address) => address.port)),
    origins: Object.freeze(addresses.map((address) => address.origin)),
    socket: socketPath ?? '',
    startedAt: Date.now(),
    version: gatewayVersion(),
    mode: daemon ? 'daemon' : 'foreground',
    args: Object.freeze([...startArguments(args)]),
    logFile,
  });
  const infoResult = (): LocalGatewayInfoResult => Object.freeze({
    gateway: info,
    instance: instanceStatus(supervisor.status()),
    consoleInitialized: gateway.http.tokenRegistry.initialized(),
  });
  control?.setHandler(createLocalRpcHandler({
    dispatch: gateway.rpc,
    ...(gateway.packages ? { packages: gateway.packages } : {}),
    ...(gateway.console ? { console: gateway.console.localAdmin } : {}),
    info: infoResult,
    shutdown: () => shutdown(0),
    http: (request) => gateway.http.localRequest(request),
  }));

  const pidFile = join(root, '.zhin.pid');
  try { writeFileSync(pidFile, String(process.pid)); } catch { /* informational */ }
  if (socketPath) {
    await writeGatewayInfo(root, { ...info, handshakeKey }).catch((error: unknown) => {
      logger.warn(formatCompact({ op: 'gateway_info_write_failed', error: error instanceof Error ? error.message : String(error) }));
    });
  }
  const origin = info.origins[0];
  logger.info(formatCompact({
    op: 'gateway_listening', pid: process.pid, ...(origin ? { http: origin } : {}),
    ...(socketPath ? { socket: socketPath } : {}), log: logFile,
  }));
  if (origin && !options.once) logger.info(`Console: ${consoleLink(origin)}`);

  let interrupted = 0;
  const onSignal = (signal: NodeJS.Signals): void => {
    interrupted += 1;
    // A second signal kills the instance without waiting for its graceful stop.
    if (interrupted > 1) void supervisor.stop({ reason: 'signal', force: true });
    shutdown(signal === 'SIGINT' ? 130 : 0);
  };
  const onSighup = (): void => { if (!daemon) onSignal('SIGHUP'); };
  const onExit = (): void => {
    supervisor.dispose();
    terminal?.restore();
    removePidFile();
  };
  const removePidFile = (): void => {
    try {
      if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) rmSync(pidFile, { force: true });
    } catch { /* already gone */ }
  };
  const signals = input.signals !== false;
  if (signals) {
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('SIGHUP', onSighup);
  }
  process.on('exit', onExit);

  // `--once`: the run ends with the instance's single generation (CI check).
  if (options.once) {
    const check = (status: InstanceStatus = supervisor.status()): void => {
      if ((status.state === 'stopped' || status.state === 'crashed') && !gateway.ownsInstanceLifecycle()) {
        shutdown(status.state === 'crashed' ? status.lastExitCode || 1 : status.lastExitCode ?? 0);
      }
    };
    void gateway.instanceStarted.then(() => {
      supervisor.on('state', check);
      check();
    });
  }
  input.onReady?.({ gateway, info, shutdown });

  try {
    return await ended;
  } finally {
    await gateway.close().catch((error: unknown) => {
      logger.warn(formatCompact({ op: 'gateway_close_failed', error: error instanceof Error ? error.message : String(error) }));
    });
    await control?.close().catch(() => undefined);
    if (socketPath) await removeGatewayInfo(root).catch(() => undefined);
    if (signals) {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      process.off('SIGHUP', onSighup);
    }
    process.off('exit', onExit);
    removePidFile();
  }
}
