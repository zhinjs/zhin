/**
 * Gateway composition (ADR 0054 §1): the HTTP server and the instance supervisor, joined by a
 * pluggable instance transport (the bridge supplies the IPC one). CLI wiring lives elsewhere.
 */
import { resolveHttpConfig, type ResolvedHttpConfig, type TokenRegistry } from '@zhin.js/host-http';
import {
  createDelegatedAccessProvider,
  isInstanceAccessDelegate,
  type InstanceTransport,
} from '@zhin.js/host-http/bridge';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createConfigDocument } from '@zhin.js/runtime';
import { findConfigFile } from '../project/config-file.js';
import { loadRuntimeEnvironmentLayers } from '../project/environment.js';
import { InstanceSupervisor, type InstanceSupervisorOptions } from '../supervisor/instance-supervisor.js';
import { GatewayPackageService } from '../packages/service.js';
import { createGatewayRpcDispatcher, type GatewayRpcDispatcher, type GatewayRpcInstance } from '../packages/rpc.js';
import { createGatewayConsoleRpc } from './console-rpc.js';
import { GatewayHttpServer } from './gateway-http-server.js';

const logger = getLogger('gateway');

/** A transport the gateway owns; `dispose` runs on gateway close. */
export interface GatewayInstanceTransport extends InstanceTransport {
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
  /** Console authentication registry (the IAM module installs its access provider on it). */
  readonly tokenRegistry?: TokenRegistry;
  readonly retryAfterSeconds?: number;
  readonly maxRequestBodyBytes?: number;
  /** Start the instance after the server listens. Default true; a failed start keeps the gateway up. */
  readonly startInstance?: boolean;
  /**
   * Dependency transactions (`gateway.packages.*`). Default: a {@link GatewayPackageService} on
   * the project root over the supervisor; `false` disables the package RPC.
   */
  readonly packages?: GatewayPackageService | false;
}

export interface RunningGateway {
  readonly http: GatewayHttpServer;
  readonly supervisor: InstanceSupervisor;
  readonly transport: GatewayInstanceTransport;
  readonly packages: GatewayPackageService | undefined;
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
  // Interim until B1.4: Console accounts live in the instance, which resolves user / API-token
  // bearers and reports whether an owner exists; without an owner (and without `http.token`)
  // the registry yields the open bootstrap principal `{ kind: 'bootstrap', open: true }`.
  const disposeAccess = !options.tokenRegistry && !server.tokenRegistry.accessProvider && isInstanceAccessDelegate(transport)
    ? server.tokenRegistry.useAccessProvider(createDelegatedAccessProvider(transport))
    : undefined;
  try {
    await server.listen();
  } catch (error) {
    disposeAccess?.();
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
    rpc,
    ownsInstanceLifecycle: () => consoleStopped || packages?.activeTransaction !== undefined,
    instanceStarted,
    close(): Promise<void> {
      closeResult ??= (async () => {
        try {
          await supervisor.stop({ reason: 'gateway-stop' }).catch(() => undefined);
          await transport.dispose?.();
        } finally {
          disposeAccess?.();
          supervisor.dispose();
          await server.close();
        }
      })();
      return closeResult;
    },
  });
}
