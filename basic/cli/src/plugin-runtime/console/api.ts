import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import { componentFeatureId, isComponentIndex } from '@zhin.js/component';
import {
  httpHostToken,
  createConsoleEventHub,
  consoleEventHubToken,
  registerConsoleRestPages,
  type ConsoleEventHub,
  type HttpHost,
} from '@zhin.js/host-http';
import type { ImRuntime, RuntimeMessageEvent } from '@zhin.js/core/runtime';
import type { LoginAssist } from '@zhin.js/core';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { bindLoginAssistStdin } from './login-assist-stdin.js';
import {
  resolvePluginLifecycleFile,
  createPluginLifecycleStore,
  type PluginLifecycleStore,
} from '../plugin-lifecycle-store.js';
import {
  INBOX_TABLE_MESSAGE,
  runtimeEventPublisherToken,
  type DatabaseHost,
  type RuntimeSnapshot,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller, RuntimeConfigDocument } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from './configuration.js';
import { installInboxMessageRecorder } from './inbox.js';
import { registerAgentConsoleRoutes } from './agent-routes.js';
import { normalizeBase, writeJson, writeSse } from './http-response.js';
import { createAgentRuntimeLeaseResolver } from './agent-console.js';
import {
  buildConsoleEntriesBody,
  buildConsoleStats,
  buildManagedPluginList,
  buildPluginDetail,
  getSystemStatusData,
  listPages,
  listSnapshotPlugins,
  readPackageVersion,
  readSnapshot,
} from './projection.js';
import { registerConsoleRpcRoute } from './rpc-route.js';

interface LoginAssistBinding {
  readonly hub: ConsoleEventHub;
  refs: number;
  readonly dispose: () => void;
}

const loginAssistBindings = new WeakMap<LoginAssist, LoginAssistBinding>();

function acquireLoginAssistBinding(assist: LoginAssist, hub: ConsoleEventHub): () => void {
  const existing = loginAssistBindings.get(assist);
  if (existing) {
    if (existing.hub !== hub) {
      throw new Error('LoginAssist cannot publish to multiple process Console hubs');
    }
    existing.refs += 1;
    return () => releaseLoginAssistBinding(assist, existing);
  }
  const unsubPending = assist.subscribe('endpoint.login.pending', (task) => {
    hub.publish('endpoint.login.pending', task);
  });
  const unsubExpired = assist.subscribe('endpoint.login.expired', (task) => {
    hub.publish('endpoint.login.expired', task);
  });
  const unbindStdin = bindLoginAssistStdin(assist);
  const binding: LoginAssistBinding = {
    hub,
    refs: 1,
    dispose: () => {
      unsubPending();
      unsubExpired();
      unbindStdin();
    },
  };
  loginAssistBindings.set(assist, binding);
  return () => releaseLoginAssistBinding(assist, binding);
}

/** Verifies canonical IM session keys against the durable Console inbox. */
export async function isKnownConversationSession(
  databaseHost: Pick<DatabaseHost, 'started' | 'models'>,
  sessionKey: string,
): Promise<boolean | undefined> {
  if (!databaseHost.started) return undefined;
  const first = sessionKey.indexOf(':');
  const second = sessionKey.indexOf(':', first + 1);
  const third = sessionKey.indexOf(':', second + 1);
  if (first <= 0 || second <= first + 1 || third <= second + 1 || third >= sessionKey.length - 1) {
    return false;
  }
  const model = databaseHost.models.get(INBOX_TABLE_MESSAGE);
  if (!model) return undefined;
  const rows = await model.select('id').where({
    adapter: sessionKey.slice(0, first),
    endpoint_id: sessionKey.slice(first + 1, second),
    channel_type: sessionKey.slice(second + 1, third),
    channel_id: sessionKey.slice(third + 1),
  }).limit(1);
  return rows.length > 0;
}

function releaseLoginAssistBinding(assist: LoginAssist, binding: LoginAssistBinding): void {
  if (loginAssistBindings.get(assist) !== binding) return;
  binding.refs -= 1;
  if (binding.refs > 0) return;
  loginAssistBindings.delete(assist);
  binding.dispose();
}


/** 已挂消息桥的 ImRuntime（installResources 按 generation 重跑，订阅只挂一次）。 */
const messageBridgeInstallations = new WeakSet<ImRuntime>();

/**
 * ImRuntime 消息事件 → SSE 事件映射（对齐 console 前端消费形态；
 * content 只发截断预览，不发完整原始段）。
 */
export function publishMessageEvent(hub: ConsoleEventHub, event: RuntimeMessageEvent): void {
  // CapabilityId 形如 `${owner}\0${feature}\0${localName}`；localName 即 endpoint 槽名。
  const localName = String(event.conversation.endpoint.id).split('\0').pop()
    ?? String(event.conversation.endpoint.id);
  if (event.direction === 'inbound') {
    const data = {
      direction: 'inbound' as const,
      adapter: localName,
      endpointKey: localName,
      sender: event.sender,
      channelType: event.conversation.kind,
      channelId: event.conversation.id,
      content: event.contentPreview,
      messageId: event.messageId,
      timestamp: event.timestamp,
    };
    hub.publish('message.receive', data);
    return;
  }
  hub.publish('message.receive', {
    direction: 'outbound' as const,
    adapter: localName,
    endpointKey: localName,
    requester: event.requester,
    channelType: event.conversation.kind,
    channelId: event.conversation.id,
    content: event.contentPreview,
    timestamp: event.timestamp,
  });
}

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
  return ({ resources, config, lifecycle }) => {
    const http = resources.use(httpHostToken);
    // Console SSE hub 同时作为 Root 级事件发布口（插件经 runtimeEventPublisherToken
    // publish endpoint:request/endpoint:notice 等收件箱事件）。
    resources.provide(runtimeEventPublisherToken, hub);
    resources.provide(consoleEventHubToken, hub);

    const loginAssist = options.im?.loginAssist;
    if (loginAssist) {
      lifecycle.add(acquireLoginAssistBinding(loginAssist, hub));
    }

    registerConsoleApiRoutes(
      http,
      options.console,
      options.projectRoot,
      apiBase,
      options.im,
      options.onRestart,
      options.databaseHost,
      options.snapshot,
      options.scheduleHost,
      hub,
      config.document,
      options.snapshots,
      options.pluginLifecycleFile ?? resolvePluginLifecycleFile(options.projectRoot),
      options.pluginLifecycleStore,
      configuration,
    );
  };
}

export function registerConsoleApiRoutes(
  http: HttpHost,
  consoleRuntime: ConsoleRuntime,
  projectRoot: string,
  apiBase = '/api',
  im?: ImRuntime,
  onRestart?: () => void,
  databaseHost?: DatabaseHost,
  snapshot?: () => RuntimeSnapshot | undefined,
  scheduleHost?: unknown,
  eventHub?: ConsoleEventHub,
  primaryConfigDocument?: RuntimeConfigDocument,
  snapshots?: SnapshotReader,
  pluginLifecycleFile = resolvePluginLifecycleFile(projectRoot),
  pluginLifecycleStore = createPluginLifecycleStore(),
  configuration = new ConsoleConfigurationStore(projectRoot),
): void {
  const base = normalizeBase(apiBase);
  const hub = eventHub ?? createConsoleEventHub();

  // 消息事件桥（demo scope 同样推送；content 仅截断预览）。
  // installResources 每个 generation 都会重跑，订阅只挂一次，避免重复推送。
  if (im && typeof im.onMessage === 'function' && !messageBridgeInstallations.has(im)) {
    messageBridgeInstallations.add(im);
    im.onMessage((event) => publishMessageEvent(hub, event));
  }

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

  // Remote Console shell plugin discovery (legacy host-api `GET /entries` parity).
  // Public path (outside apiBase) — the loader still sends Bearer when present.
  http.route('GET', '/entries', async (_request, response) => {
    try {
      const pages = await listPages(consoleRuntime);
      writeJson(response, 200, buildConsoleEntriesBody(pages));
    } catch (error) {
      writeJson(response, 503, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Console entries (plugin discovery)',
    tags: ['console'],
  });

  http.route('GET', `${base}/system/status`, (_request, response) => {
    writeJson(response, 200, { success: true, data: getSystemStatusData() });
  }, {
    summary: 'System status snapshot',
    tags: ['system'],
  });

  http.route('GET', `${base}/stats`, async (_request, response) => {
    try {
      const endpoints = im ? im.listEndpoints() : [];
      const snap = readSnapshot(snapshot);
      // dashboard 命令/组件卡片：CommandIndex / ComponentIndex 投影计数
      const commandIndex = snap?.projections.get(commandFeatureId);
      const commandCount = isCommandIndex(commandIndex) ? commandIndex.list().length : 0;
      const componentIndex = snap?.projections.get(componentFeatureId);
      const componentCount = isComponentIndex(componentIndex) ? componentIndex.list().length : 0;
      writeJson(response, 200, {
        success: true,
        data: {
          ...buildConsoleStats(listSnapshotPlugins(snap).length, endpoints),
          commands: commandCount,
          components: componentCount,
        },
      });
    } catch (error) {
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Dashboard statistics',
    tags: ['system'],
  });

  http.route('GET', `${base}/plugins`, async (_request, response) => {
    try {
      const snap = readSnapshot(snapshot);
      const plugins = await buildManagedPluginList(
        projectRoot,
        pluginLifecycleFile,
        snap,
        im?.listEndpoints() ?? [],
      );
      writeJson(response, 200, { success: true, data: plugins, total: plugins.length });
    } catch (error) {
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'List loaded plugins',
    tags: ['plugins'],
  });

  http.route('GET', `${base}/plugins/*`, async (_request, response, url) => {
    const prefix = `${base}/plugins/`;
    const raw = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
    // 未解码段内不允许嵌套路径；scoped 包名（%40scope%2Fname）解码后含 '/' 属正常。
    if (!raw || raw.includes('/')) {
      writeJson(response, 404, { success: false, error: '插件不存在' });
      return;
    }
    let name = '';
    try {
      name = decodeURIComponent(raw);
    } catch {
      writeJson(response, 400, { success: false, error: 'Invalid plugin name' });
      return;
    }
    try {
      const snap = readSnapshot(snapshot);
      const node = listSnapshotPlugins(snap)
        .find((item) => item.instanceKey === name || item.packageName === name);
      if (!node) {
        writeJson(response, 404, { success: false, error: '插件不存在' });
        return;
      }
      writeJson(response, 200, {
        success: true,
        data: buildPluginDetail(
          node,
          await readPackageVersion(node.packageRoot),
          snap,
          im?.listEndpoints(),
          projectRoot,
        ),
      });
    } catch (error) {
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Plugin detail',
    tags: ['plugins'],
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

  http.route('GET', `${base}/events/history`, (_request, response, url) => {
    const page = hub.history({
      runtimeId: url.searchParams.get('runtimeId') ?? undefined,
      after: Number(url.searchParams.get('after') ?? 0),
      limit: Number(url.searchParams.get('limit') ?? 200),
    });
    writeJson(response, 200, { success: true, data: page });
  }, {
    summary: 'Console event history',
    tags: ['console'],
    description: 'Bounded resumable history for the current Console event runtime.',
  });

  http.route('GET', `${base}/events`, async (request, response, url) => {
    const pages = await listPages(consoleRuntime);
    const headerLastEventId = Array.isArray(request.headers['last-event-id'])
      ? request.headers['last-event-id'][0]
      : request.headers['last-event-id'];
    const after = Number(
      url.searchParams.get('after')
      ?? url.searchParams.get('lastEventId')
      ?? headerLastEventId
      ?? 0,
    );
    const eventRuntimeId = url.searchParams.get('runtimeId') ?? undefined;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-zhin-event-runtime-id': hub.runtimeId,
    });
    // Snapshot frames intentionally have no event id: the resumable cursor is
    // reserved for journalled hub events and can never collide with them.
    writeSse(response, 'sync', { key: 'pages', value: pages });
    writeSse(response, 'init-data', { timestamp: Date.now() });
    const unsubscribe = hub.subscribe(response, {
      runtimeId: eventRuntimeId,
      after: Number.isSafeInteger(after) && after >= 0 ? after : 0,
    });
    const timer = setInterval(() => {
      try {
        response.write(': keepalive\n\n');
      } catch {
        clearInterval(timer);
      }
    }, 15_000);
    request.once('close', () => {
      clearInterval(timer);
      unsubscribe();
      try {
        response.end();
      } catch {
        /* already closed */
      }
    });
  }, {
    summary: 'Console SSE stream',
    tags: ['console'],
  });

  registerAgentConsoleRoutes({ http, base, snapshots });

}
