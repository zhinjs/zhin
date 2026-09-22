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
} from '../plugin-lifecycle-store.js';
import { registerConsoleRoutes } from './api-routes.js';
import { ConsoleConfigurationStore } from './configuration.js';
import { normalizeBase } from './http-response.js';
import { ConsoleLoginAssistBindings } from './login-assist-binding.js';
import { ConsoleMessageBindings } from './message-bindings.js';

export interface ConsoleControlPlaneOptions {
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
      databaseHost: options.databaseHost,
      snapshot: options.snapshot,
      scheduleHost: options.scheduleHost,
      eventHub: hub,
      snapshots: options.snapshots,
      pluginLifecycleFile: options.pluginLifecycleFile
        ?? resolvePluginLifecycleFile(options.projectRoot),
      pluginLifecycleStore: options.pluginLifecycleStore,
      configuration,
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
