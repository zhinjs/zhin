import type { HostConsoleRpcFactory } from './plugin-console-rpc.js';
import {
  consoleEventHubToken,
  createConsoleEventHub,
  type ConsoleEventHub,
  type HttpHost,
} from '@zhin.js/host-http';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import {
  runtimeEventPublisherToken,
  type DatabaseHost,
  type RuntimeSnapshot,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  resolvePluginLifecycleFile,
  type PluginLifecycleStore,
} from '@zhin.js/runtime';
import { registerConsoleRoutes } from './api-routes.js';
import { ConsoleConfigurationStore } from '@zhin.js/gateway/config';
import { normalizeBase } from '@zhin.js/gateway/http';
import { ConsoleLoginAssistBindings } from './login-assist-binding.js';
import { ConsoleMessageBindings } from './message-bindings.js';
import { createPluginPermissionCatalogSource } from './plugin-permission-catalog.js';

export interface ConsoleControlPlaneOptions {
  readonly pluginManagementActivity?: import('@zhin.js/gateway/plugin-management').PluginManagementActivity;
  readonly console: ConsoleRuntime;
  readonly projectRoot: string;
  readonly apiBase?: string;
  readonly im?: ImRuntime;
  readonly databaseHost?: DatabaseHost;
  readonly snapshot?: () => RuntimeSnapshot | undefined;
  readonly snapshots?: SnapshotReader;
  readonly scheduleHost?: unknown;
  readonly onRestart?: () => void;
  readonly pluginLifecycleFile?: string;
  readonly pluginLifecycleStore: PluginLifecycleStore;
  readonly eventHub?: ConsoleEventHub;
  readonly configuration: ConsoleConfigurationStore;
  /** Host-owned Console methods resolved from each request's captured Root lease. */
  readonly hostConsoleRpc?: HostConsoleRpcFactory;
  /** Console access control (ADR 0049). */
  readonly consoleIam?: () => import('@zhin.js/gateway/iam').ConsoleIamService | undefined;
  /** Conversation-level feature overrides and in-chat feature admins (ADR 0055). */
  readonly featureStores?: import('./console-feature-rpc.js').FeatureStores;
}

export interface StartConsoleControlPlaneOptions extends ConsoleControlPlaneOptions {
  readonly http: HttpHost;
}

/**
 * Starts the process-owned Console control plane.
 *
 * This surface must exist before the first Runtime generation activates: an
 * Adapter may pause activation for QR, slider, or device confirmation, and the
 * Console is the consumer that resolves that login task.
 */
export function startConsoleControlPlane(options: StartConsoleControlPlaneOptions): () => void {
  const apiBase = normalizeBase(options.apiBase ?? '/api');
  const hub = options.eventHub ?? createConsoleEventHub();
  const configuration = options.configuration;
  const loginAssistBindings = new ConsoleLoginAssistBindings();
  const messageBindings = new ConsoleMessageBindings({
    hub,
    databaseHost: options.databaseHost,
  });
  const disposers: Array<() => void> = [];

  if (options.im) disposers.push(messageBindings.acquire(options.im));
  // Plugin permission catalog for level grants (ADR 0049 amendment 2026-11-11).
  if (options.snapshots && typeof options.http.tokenRegistry?.usePluginPermissions === 'function') {
    disposers.push(options.http.tokenRegistry.usePluginPermissions(createPluginPermissionCatalogSource({
      snapshots: options.snapshots,
      ...(options.hostConsoleRpc ? { hostConsoleRpc: options.hostConsoleRpc } : {}),
    })));
  }
  const loginAssist = options.im?.loginAssist;
  if (loginAssist) disposers.push(loginAssistBindings.acquire(loginAssist, hub));

  try {
    registerConsoleRoutes({
      http: options.http,
      consoleRuntime: options.console,
      projectRoot: options.projectRoot,
      apiBase,
      im: options.im,
      onRestart: options.onRestart,
      pluginManagementActivity: options.pluginManagementActivity,
      databaseHost: options.databaseHost,
      snapshot: options.snapshot,
      scheduleHost: options.scheduleHost,
      eventHub: hub,
      snapshots: options.snapshots,
      pluginLifecycleFile: options.pluginLifecycleFile
        ?? resolvePluginLifecycleFile(options.projectRoot),
      pluginLifecycleStore: options.pluginLifecycleStore,
      configuration,
      ...(options.hostConsoleRpc ? { hostConsoleRpc: options.hostConsoleRpc } : {}),
      ...(options.consoleIam ? { consoleIam: options.consoleIam } : {}),
      ...(options.featureStores ? { featureStores: options.featureStores } : {}),
    });
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.reverse()) dispose();
  };
}

/** Publishes process services into each generation without owning their ingress. */
export function installConsoleApiResources(
  eventHub: ConsoleEventHub,
): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(runtimeEventPublisherToken, eventHub);
    resources.provide(consoleEventHubToken, eventHub);
  };
}
