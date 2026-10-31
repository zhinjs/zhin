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
import { registerConversationHistoryRoutes } from './conversation-history-routes.js';
import { registerConversationResultRoutes } from './conversation-result-routes.js';
import { registerDataMigrationRoutes } from './data-migration-routes.js';
import { registerInteractionRoutes } from './interaction-routes.js';
import { registerWorkspaceConversationRoutes } from './workspace-conversation-routes.js';
import { registerConsoleEntryRoutes } from './entry-routes.js';
import { registerConsoleEventRoutes } from './events.js';
import { normalizeBase } from './http-response.js';
import { registerConsolePluginRoutes } from './plugin-routes.js';
import { createPluginManagementPort } from './plugin-management.js';
import { registerConsoleRpcRoute } from './rpc-route.js';
import { registerConsoleSystemRoutes } from './system-routes.js';
import { registerMessageDiagnosticRoutes } from './message-diagnostic-routes.js';
import { registerPluginTaskRoutes } from './plugin-task-routes.js';
import { registerPermissionExplanationRoutes } from './permission-explanation-routes.js';

export interface RegisterConsoleRoutesOptions {
  readonly pluginManagementActivity?: import('../../plugin-management/activity.js').PluginManagementActivity;
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
  readonly hostConsoleRpc?: import('./plugin-console-rpc.js').HostConsoleRpcFactory;
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
    pluginLifecycleStore = createPluginLifecycleStore(projectRoot),
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
  registerMessageDiagnosticRoutes({ http, base, diagnostics: im?.messageDiagnostics });
  registerConversationHistoryRoutes({ http, base, im, databaseHost, snapshots });
  registerConversationResultRoutes({ http, base, projectRoot, snapshots });
  registerInteractionRoutes({ http, base, im, snapshots });
  registerDataMigrationRoutes({ http, base, projectRoot, snapshots });
  registerWorkspaceConversationRoutes({ http, base, snapshots, databaseHost });
  registerPluginTaskRoutes({ http, base, snapshots });
  registerPermissionExplanationRoutes({ http, base, snapshots });
  const pluginManagement = createPluginManagementPort(projectRoot, {
    activity: options.pluginManagementActivity,
    snapshots,
    lifecycleFile: pluginLifecycleFile,
    requestRestart: onRestart ? () => { setTimeout(onRestart, 500); } : undefined,
  });
  registerConsolePluginRoutes({
    http,
    base,
    projectRoot,
    pluginLifecycleFile,
    im,
    snapshot,
    pluginManagement,
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
    pluginManagement,
    im,
    onRestart,
    databaseHost,
    scheduleHost,
    snapshots,
    ...(options.hostConsoleRpc ? { hostConsoleRpc: options.hostConsoleRpc } : {}),
  });
  registerConsoleEventRoutes({ http, base, consoleRuntime, hub: eventHub });
  registerAgentConsoleRoutes({ http, base, snapshots, projectRoot });
}
