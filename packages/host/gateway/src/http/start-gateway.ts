/**
 * Gateway composition (ADR 0054 §1): the HTTP server and the instance supervisor, joined by a
 * pluggable instance transport (the bridge supplies the IPC one). CLI wiring lives elsewhere.
 */
import { isLoopbackHost, resolveHttpConfig, type ResolvedHttpConfig, type TokenRegistry } from '@zhin.js/host-http';
import type { InstanceTransport } from '@zhin.js/host-http/bridge';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createConfigDocument } from '@zhin.js/runtime';
import { findConfigFile } from '../project/config-file.js';
import { loadRuntimeEnvironmentLayers } from '../project/environment.js';
import { InstanceSupervisor, type InstanceSupervisorOptions } from '../supervisor/instance-supervisor.js';
import { GatewayPackageService } from '../packages/service.js';
import { createGatewayRpcDispatcher, type GatewayRpcDispatcher, type GatewayRpcInstance } from '../packages/rpc.js';
import { createGatewayConsoleRpc } from './console-rpc.js';
import { startGatewayConsole, type GatewayConsole, type GatewayConsoleInstancePort, type GatewayConsoleOptions } from './gateway-console.js';
import { registerGatewayEventRoutes } from './gateway-events.js';
import { GatewayHttpServer } from './gateway-http-server.js';

const logger = getLogger('gateway');

/**
 * A transport the gateway owns; `dispose` runs on gateway close. The Console module also uses the
 * optional {@link GatewayConsoleInstancePort} methods (plugin catalog, instance audit,
 * `principal-revoked`) when the transport has them (`IpcInstanceTransport` does).
 */
export interface GatewayInstanceTransport extends InstanceTransport, GatewayConsoleInstancePort {
  dispose?(): void | Promise<void>;
  /** Told the bound listener addresses after listen (the instance's `HttpHost.address`). */
  setAddresses?(addresses: readonly import('@zhin.js/host-http').HttpHostAddress[]): void;
}

export interface InstanceTransportFactoryContext {
  readonly supervisor: InstanceSupervisor;
  readonly projectRoot: string;
}

export type InstanceTransportFactory = (context: InstanceTransportFactoryContext) => GatewayInstanceTransport;

export interface StartGatewayOptions {
  readonly projectRoot: string;
  /** Selects `.env.<environment>` for `http.*` placeholders. Default `development`. */
  readonly environment?: string;
  /** Overrides the `http` block of the project config. */
  readonly http?: ResolvedHttpConfig;
  /** Instance supervision; pass a supervisor to own its construction. */
  readonly supervisor: InstanceSupervisorOptions | InstanceSupervisor;
  readonly transport: InstanceTransportFactory;
  /** Console authentication registry (the Console module installs its access provider on it). */
  readonly tokenRegistry?: TokenRegistry;
  /**
   * Console access control in the gateway (project database, `/auth/*`, `iam.*`, setup,
   * onboarding, terminal, audit). Default on; `false` leaves only the bootstrap token (tests).
   */
  readonly console?: false | Omit<GatewayConsoleOptions, 'server' | 'projectRoot' | 'environment' | 'instance' | 'restartInstance'>;
  /** Longest wait for the project database before listening anyway (default 10 s). */
  readonly databaseWaitMs?: number;
  readonly retryAfterSeconds?: number;
  readonly maxRequestBodyBytes?: number;
  /** Start the instance after the server listens. Default true; a failed start keeps the gateway up. */
  readonly startInstance?: boolean;
  /**
   * Dependency transactions (`gateway.packages.*`). Default: a {@link GatewayPackageService} on
   * the project root over the supervisor; `false` disables the package RPC.
   */
  readonly packages?: GatewayPackageService | false;
  /** `gateway.readyTimeout` for dependency transactions (see {@link loadGatewaySettings}). Default 60 s. */
  readonly readyTimeoutMs?: number;
}

export interface RunningGateway {
  readonly http: GatewayHttpServer;
  readonly supervisor: InstanceSupervisor;
  readonly transport: GatewayInstanceTransport;
  readonly packages: GatewayPackageService | undefined;
  /** Console access control; undefined with `console: false`. */
  readonly console: GatewayConsole | undefined;
  /** The gateway RPC (`gateway.packages.*`, `gateway.instance.*`), shared with the local socket. */
  readonly rpc: GatewayRpcDispatcher;
  /**
   * True while the gateway owns the instance's lifecycle: a dependency transaction runs, or the
   * Console stopped the instance (a run must not end because of it).
   */
  ownsInstanceLifecycle(): boolean;
  /** Resolves when the first instance start attempt settled (never rejects). */
  readonly instanceStarted: Promise<void>;
  /** Stops the instance, then closes the listeners. */
  close(): Promise<void>;
}

/**
 * Reads and resolves the project's `http` config the same way the instance used to. Only the
 * `http` block is read: plugin declarations are not validated here, so a config the instance
 * rejects still leaves the Console reachable.
 */
export async function loadGatewayHttpConfig(projectRoot: string, environment = 'development'): Promise<ResolvedHttpConfig> {
  const file = findConfigFile(projectRoot);
  if (!file) return {};
  const [document, layers] = await Promise.all([
    createConfigDocument(join(projectRoot, file)).read().then((snapshot) => snapshot.document),
    loadRuntimeEnvironmentLayers(projectRoot, environment),
  ]);
  return resolveHttpConfig(document, layers.environments?.[environment], projectRoot);
}

/** The project's `gateway` block (ADR 0054 §4 / §5). */
export interface GatewaySettings {
  /** `gateway.readyTimeout` (seconds) in ms; undefined: the built-in 60 s. */
  readonly readyTimeoutMs?: number;
}

/**
 * Reads the `gateway` block. An invalid value is logged and ignored (the instance rejects the
 * config on its own); like {@link loadGatewayHttpConfig}, it never keeps the gateway down.
 */
export async function loadGatewaySettings(projectRoot: string): Promise<GatewaySettings> {
  const file = findConfigFile(projectRoot);
  if (!file) return {};
  let block: unknown;
  try {
    block = (await createConfigDocument(join(projectRoot, file)).read()).document.gateway;
  } catch {
    return {};
  }
  if (block === undefined || block === null) return {};
  const readyTimeout = typeof block === 'object' && !Array.isArray(block) ? (block as Record<string, unknown>).readyTimeout : undefined;
  if (readyTimeout === undefined) return {};
  if (typeof readyTimeout === 'number' && Number.isInteger(readyTimeout) && readyTimeout >= 1 && readyTimeout <= 3600) {
    return Object.freeze({ readyTimeoutMs: readyTimeout * 1000 });
  }
  logger.warn(formatCompact({ op: 'gateway_config_invalid', key: 'gateway.readyTimeout', hint: 'integer seconds 1-3600; using 60' }));
  return {};
}

export async function startGateway(options: StartGatewayOptions): Promise<RunningGateway> {
  const http = options.http ?? await loadGatewayHttpConfig(options.projectRoot, options.environment);
  const supervisor = options.supervisor instanceof InstanceSupervisor
    ? options.supervisor
    : new InstanceSupervisor(options.supervisor);
  const transport = options.transport({ supervisor, projectRoot: options.projectRoot });
  // `tokenRegistry` is read lazily: the server creates the default one.
  let registry: TokenRegistry | undefined = options.tokenRegistry;
  const packages = options.packages === false
    ? undefined
    : options.packages ?? new GatewayPackageService({
      projectRoot: options.projectRoot,
      instance: supervisor,
      ...(options.readyTimeoutMs !== undefined ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
      hasOwner: () => registry?.initialized() ?? true,
    });
  let consoleStopped = false;
  const lifecycle: GatewayRpcInstance = {
    start: async () => { await supervisor.start(); consoleStopped = false; },
    stop: async (stopOptions) => { consoleStopped = true; await supervisor.stop(stopOptions); },
    restart: async (restartOptions) => { await supervisor.restart(restartOptions); consoleStopped = false; },
    status: () => supervisor.status(),
    logs: supervisor.logs,
  };
  const rpc = createGatewayRpcDispatcher({
    ...(packages ? { packages } : {}),
    instance: lifecycle,
  });
  const server = new GatewayHttpServer({
    http,
    instance: { transport: () => transport, state: () => supervisor.state },
    ...(options.tokenRegistry ? { tokenRegistry: options.tokenRegistry } : {}),
    ...(options.retryAfterSeconds !== undefined ? { retryAfterSeconds: options.retryAfterSeconds } : {}),
    ...(options.maxRequestBodyBytes !== undefined ? { maxRequestBodyBytes: options.maxRequestBodyBytes } : {}),
    consoleRpc: createGatewayConsoleRpc(rpc),
  });
  registry = server.tokenRegistry;
  const disposeEvents = registerGatewayEventRoutes({
    server,
    ...(packages ? { packages } : {}),
    instance: { onChange: (listener) => transport.onRoutes(() => listener()) },
  });
  let gatewayConsole: GatewayConsole | undefined;
  try {
    // ADR 0054 §7: Console accounts live in the gateway's own connection to the project database.
    if (options.console !== false) {
      gatewayConsole = await startGatewayConsole({
        ...(options.console ?? {}),
        server,
        projectRoot: options.projectRoot,
        ...(options.environment ? { environment: options.environment } : {}),
        instance: transport,
        restartInstance: async () => {
          if (supervisor.state !== 'stopped') await supervisor.restart({ reason: 'database' });
        },
      });
      await settleWithin(gatewayConsole.ready, options.databaseWaitMs ?? 10_000);
    }
    assertNotOpenOnNetwork(http, server.tokenRegistry);
    await server.listen();
  } catch (error) {
    disposeEvents();
    await gatewayConsole?.close().catch(() => undefined);
    await transport.dispose?.();
    supervisor.dispose();
    throw error;
  }
  transport.setAddresses?.(server.addresses);
  const instanceStarted = options.startInstance === false
    ? Promise.resolve()
    : supervisor.start().catch((error: unknown) => {
      // The Console stays reachable to show the failure and the logs.
      logger.warn(formatCompact({
        op: 'gateway_instance_start_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  let closeResult: Promise<void> | undefined;
  return Object.freeze({
    http: server,
    supervisor,
    transport,
    packages,
    console: gatewayConsole,
    rpc,
    ownsInstanceLifecycle: () => consoleStopped || packages?.activeTransaction !== undefined,
    instanceStarted,
    close(): Promise<void> {
      closeResult ??= (async () => {
        try {
          await supervisor.stop({ reason: 'gateway-stop' }).catch(() => undefined);
          await transport.dispose?.();
        } finally {
          disposeEvents();
          await gatewayConsole?.close().catch(() => undefined);
          supervisor.dispose();
          await server.close();
        }
      })();
      return closeResult;
    },
  });
}

/** Thrown when the gateway would serve an open Host on a network address. */
export class OpenHostOnNetworkError extends Error {
  readonly code = 'ZHIN_OPEN_HOST_ON_NETWORK';
  constructor(readonly host: string) {
    super(`http.host 为 ${host}（可从网络访问），但既没有初始化令牌（http.token），Console 也还没有所有者：`
      + '开放模式拥有全部权限，只允许监听本机地址。请运行 zhin doctor --fix 在 .env 生成 HTTP_TOKEN 并在配置里用 '
      + 'http.token: ${HTTP_TOKEN} 引用，或先运行 zhin console init 创建所有者；也可以把 http.host 改为 127.0.0.1。');
    this.name = 'OpenHostOnNetworkError';
  }
}

/**
 * An open Host (no bootstrap token, no owner yet) holds every permission and is only meant for
 * this machine. The per-request loopback check cannot see through a same-host reverse proxy that
 * adds no forwarding header, so a network-facing `http.host` must not start open (ADR 0049 §1).
 */
export function assertNotOpenOnNetwork(http: ResolvedHttpConfig, registry: TokenRegistry): void {
  if (registry.hasAnyToken() || isLoopbackHost(http.host)) return;
  throw new OpenHostOnNetworkError(http.host ?? '');
}

/** Waits for `promise` at most `ms` (the gateway listens anyway; the work continues). */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
}
