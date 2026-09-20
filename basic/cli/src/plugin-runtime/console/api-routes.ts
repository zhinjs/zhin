import { registerConsoleRestPages, type ConsoleEventHub, type HttpHost } from '@zhin.js/host-http';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type {
  DatabaseHost,
  RuntimeSnapshot,
  SnapshotReader,
} from '@zhin.js/plugin-runtime';
import {
  createPluginLifecycleStore,
  resolvePluginLifecycleFile,
  type PluginLifecycleStore,
} from '../plugin-lifecycle-store.js';
import { registerAgentConsoleRoutes } from './agent-routes.js';
import { createAgentRuntimeLeaseResolver } from './agent-runtime-resolver.js';
import { ConsoleConfigurationStore } from './configuration.js';
import { isKnownConversationSession } from './conversation-session.js';
import { registerConsoleEntryRoutes } from './entry-routes.js';
import { registerConsoleEventRoutes } from './events.js';
import { normalizeBase } from './http-response.js';
import { registerConsolePluginRoutes } from './plugin-routes.js';
import { createPluginManagementPort } from './plugin-management.js';
import { registerConsoleRpcRoute } from './rpc-route.js';
import { registerConsoleSystemRoutes } from './system-routes.js';

export interface RegisterConsoleRoutesOptions {
  readonly http: HttpHost;
  readonly consoleRuntime: ConsoleRuntime;
  readonly projectRoot: string;
  readonly apiBase?: string;
  readonly im?: ImRuntime;
  readonly onRestart?: () => void;
  readonly databaseHost?: DatabaseHost;
  readonly snapshot?: () => RuntimeSnapshot | undefined;
  readonly scheduleHost?: unknown;
  readonly eventHub: ConsoleEventHub;
  readonly snapshots?: SnapshotReader;
  readonly pluginLifecycleFile?: string;
  readonly pluginLifecycleStore?: PluginLifecycleStore;
  readonly configuration: ConsoleConfigurationStore;
}

/** Registers the Console HTTP surface without installing process-level subscriptions. */
export function registerConsoleRoutes(options: RegisterConsoleRoutesOptions): void {
  const {
    http,
    consoleRuntime,
    projectRoot,
    apiBase = '/api',
    im,
    onRestart,
    databaseHost,
    snapshot,
    scheduleHost,
    eventHub,
    snapshots,
    pluginLifecycleFile = resolvePluginLifecycleFile(projectRoot),
    pluginLifecycleStore = createPluginLifecycleStore(),
    configuration,
  } = options;
  const base = normalizeBase(apiBase);

  registerConsoleRestPages(http, {
    fullScope: true,
    projectRoot,
    getEndpoints: im ? () => im.endpoints.list() : undefined,
    acquireAgentRuntime: createAgentRuntimeLeaseResolver(projectRoot, snapshots),
    isKnownConversationSession: databaseHost
      ? (sessionKey) => isKnownConversationSession(databaseHost, sessionKey)
      : undefined,
    databaseHost: databaseHost
      ? {
        dialect: databaseHost.dialect,
        get started() { return databaseHost.started; },
        models: databaseHost.models,
      }
      : undefined,
  }, { apiBase: base });

  registerConsoleEntryRoutes({ http, consoleRuntime });
  registerConsoleSystemRoutes({ http, base, im, snapshot });
  registerConsolePluginRoutes({
    http,
    base,
    projectRoot,
    pluginLifecycleFile,
    im,
    snapshot,
  });
  registerConsoleRpcRoute({
    http,
    base,
    consoleRuntime,
    projectRoot,
    hub: eventHub,
    pluginLifecycleFile,
    pluginLifecycleStore,
    configuration,
    pluginManagement: createPluginManagementPort(projectRoot, {
      readConfigRevision: () => configuration.readSource().then(source => source.revision),
      readConfigDocument: () => configuration.readDocument(),
      removeConfigKey: (instanceKey) => configuration.removeKey(instanceKey),
    }),
    im,
    onRestart,
    databaseHost,
    scheduleHost,
    snapshots,
  });
  registerConsoleEventRoutes({ http, base, consoleRuntime, hub: eventHub });
  registerAgentConsoleRoutes({ http, base, snapshots });
}
