import {
  httpHostToken,
  createConsoleEventHub,
  consoleEventHubToken,
  registerConsoleRestPages,
  type ConsoleEventHub,
  type HttpHost,
} from '@zhin.js/host-http';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import {
  resolvePluginLifecycleFile,
  createPluginLifecycleStore,
  type PluginLifecycleStore,
} from '../plugin-lifecycle-store.js';
import {
  runtimeEventPublisherToken,
  type DatabaseHost,
  type RuntimeSnapshot,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller, RuntimeConfigDocument } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from './configuration.js';
import { isKnownConversationSession } from './conversation-session.js';
import { installInboxMessageRecorder } from './inbox.js';
import { registerAgentConsoleRoutes } from './agent-routes.js';
import { registerConsoleEntryRoutes } from './entry-routes.js';
import { installMessageEventBridge, registerConsoleEventRoutes } from './events.js';
import { normalizeBase } from './http-response.js';
import { ConsoleLoginAssistBindings } from './login-assist-binding.js';
import { createAgentRuntimeLeaseResolver } from './agent-console.js';
import { registerConsolePluginRoutes } from './plugin-routes.js';
import { registerConsoleRpcRoute } from './rpc-route.js';
import { registerConsoleSystemRoutes } from './system-routes.js';

export function installConsoleApi(options: {
  readonly console: ConsoleRuntime;
  readonly projectRoot: string;
  readonly apiBase?: string;
  /** When provided, wires `endpoint.*` RPC to AdapterIndex via ImRuntime. */
  readonly im?: ImRuntime;
  /** When provided, wires `db:info` / `db:tables` RPC to the Database host. */
  readonly databaseHost?: DatabaseHost;
  /** Snapshot accessor backing `/api/stats` and `/api/plugins*`. */
  readonly snapshot?: () => RuntimeSnapshot | undefined;
  /** Snapshot lease authority for Agent-backed async operations. */
  readonly snapshots?: SnapshotReader;
  /** ScheduleHost — wires `schedule:list`/`cron:list` extended RPC. */
  readonly scheduleHost?: unknown;
  /** Full-scope `system:restart` — uses the native-TS supervisor restart exit code. */
  readonly onRestart?: () => void;
  /** Durable child Plugin enable/disable state. */
  readonly pluginLifecycleFile?: string;
  /** Process-composition-owned writer that serializes lifecycle state updates. */
  readonly pluginLifecycleStore: PluginLifecycleStore;
  /** Shared console event hub (`hmr:reload` 等由 RootHost 层 publish）。 */
  readonly eventHub?: ConsoleEventHub;
}): RootResourceInstaller {
  const apiBase = normalizeBase(options.apiBase ?? '/api');
  const hub = options.eventHub ?? createConsoleEventHub();
  const configuration = new ConsoleConfigurationStore(options.projectRoot);
  const loginAssistBindings = new ConsoleLoginAssistBindings();
  return ({ resources, config, lifecycle }) => {
    const http = resources.use(httpHostToken);
    // Console SSE hub 同时作为 Root 级事件发布口（插件经 runtimeEventPublisherToken
    // publish endpoint:request/endpoint:notice 等收件箱事件）。
    resources.provide(runtimeEventPublisherToken, hub);
    resources.provide(consoleEventHubToken, hub);

    const loginAssist = options.im?.loginAssist;
    if (loginAssist) {
      lifecycle.add(loginAssistBindings.acquire(loginAssist, hub));
    }

    registerConsoleApiRoutes({
      http,
      consoleRuntime: options.console,
      projectRoot: options.projectRoot,
      apiBase,
      im: options.im,
      onRestart: options.onRestart,
      databaseHost: options.databaseHost,
      snapshot: options.snapshot,
      scheduleHost: options.scheduleHost,
      eventHub: hub,
      primaryConfigDocument: config.document,
      snapshots: options.snapshots,
      pluginLifecycleFile: options.pluginLifecycleFile
        ?? resolvePluginLifecycleFile(options.projectRoot),
      pluginLifecycleStore: options.pluginLifecycleStore,
      configuration,
    });
  };
}

export interface RegisterConsoleApiRoutesOptions {
  readonly http: HttpHost;
  readonly consoleRuntime: ConsoleRuntime;
  readonly projectRoot: string;
  readonly apiBase?: string;
  readonly im?: ImRuntime;
  readonly onRestart?: () => void;
  readonly databaseHost?: DatabaseHost;
  readonly snapshot?: () => RuntimeSnapshot | undefined;
  readonly scheduleHost?: unknown;
  readonly eventHub?: ConsoleEventHub;
  readonly primaryConfigDocument?: RuntimeConfigDocument;
  readonly snapshots?: SnapshotReader;
  readonly pluginLifecycleFile?: string;
  readonly pluginLifecycleStore?: PluginLifecycleStore;
  readonly configuration?: ConsoleConfigurationStore;
}

export function registerConsoleApiRoutes(options: RegisterConsoleApiRoutesOptions): void {
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
    primaryConfigDocument,
    snapshots,
    pluginLifecycleFile = resolvePluginLifecycleFile(projectRoot),
    pluginLifecycleStore = createPluginLifecycleStore(),
    configuration = new ConsoleConfigurationStore(projectRoot),
  } = options;
  const base = normalizeBase(apiBase);
  const hub = eventHub ?? createConsoleEventHub();

  installMessageEventBridge(im, hub);

  // 收件箱写路径：onMessage → unified_inbox_message（表由 start-command 在
  // createDatabaseHost 后 defineInboxTables 注册；此处仅订阅写入）。
  if (im && databaseHost && typeof im.onMessage === 'function') {
    installInboxMessageRecorder(im, databaseHost);
  }

  // REST 六组（logs / marketplace / introspection / agent sessions 等，host-http 实现）
  registerConsoleRestPages(http, {
    fullScope: true,
    projectRoot,
    getEndpoints: im
      ? () => im.listEndpoints()
      : undefined,
    acquireAgentRuntime: createAgentRuntimeLeaseResolver(projectRoot, snapshots),
    isKnownConversationSession: databaseHost
      ? (sessionKey) => isKnownConversationSession(databaseHost, sessionKey)
      : undefined,
    databaseHost: databaseHost
      ? {
        dialect: databaseHost.dialect,
        // 动态 getter：路由注册早于 DatabaseHost.start()，静态快照会恒为 false
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
    hub,
    pluginLifecycleFile,
    pluginLifecycleStore,
    configuration,
    im,
    onRestart,
    databaseHost,
    scheduleHost,
    primaryConfigDocument,
    snapshots,
  });

  registerConsoleEventRoutes({ http, base, consoleRuntime, hub });

  registerAgentConsoleRoutes({ http, base, snapshots });

}
