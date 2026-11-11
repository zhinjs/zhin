/**
 * Gateway composition (ADR 0054 §1): the HTTP server and the instance supervisor, joined by a
 * pluggable instance transport (the bridge supplies the IPC one). CLI wiring lives elsewhere.
 */
import { resolveHttpConfig, type ResolvedHttpConfig, type TokenRegistry } from '@zhin.js/host-http';
import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createConfigDocument } from '@zhin.js/runtime';
import { findConfigFile } from '../project/config-file.js';
import { loadRuntimeEnvironmentLayers } from '../project/environment.js';
import { InstanceSupervisor, type InstanceSupervisorOptions } from '../supervisor/instance-supervisor.js';
import { GatewayHttpServer } from './gateway-http-server.js';
import type { InstanceTransport } from './instance-transport.js';

const logger = getLogger('gateway');

/** A transport the gateway owns; `dispose` runs on gateway close. */
export interface GatewayInstanceTransport extends InstanceTransport {
  dispose?(): void | Promise<void>;
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
}

export interface RunningGateway {
  readonly http: GatewayHttpServer;
  readonly supervisor: InstanceSupervisor;
  readonly transport: GatewayInstanceTransport;
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
  const server = new GatewayHttpServer({
    http,
    instance: { transport: () => transport, state: () => supervisor.state },
    ...(options.tokenRegistry ? { tokenRegistry: options.tokenRegistry } : {}),
    ...(options.retryAfterSeconds !== undefined ? { retryAfterSeconds: options.retryAfterSeconds } : {}),
    ...(options.maxRequestBodyBytes !== undefined ? { maxRequestBodyBytes: options.maxRequestBodyBytes } : {}),
  });
  try {
    await server.listen();
  } catch (error) {
    await transport.dispose?.();
    supervisor.dispose();
    throw error;
  }
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
    instanceStarted,
    close(): Promise<void> {
      closeResult ??= (async () => {
        try {
          await supervisor.stop({ reason: 'gateway-stop' }).catch(() => undefined);
          await transport.dispose?.();
        } finally {
          supervisor.dispose();
          await server.close();
        }
      })();
      return closeResult;
    },
  });
}
