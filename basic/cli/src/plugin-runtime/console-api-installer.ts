import { access, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { ServerResponse } from 'node:http';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import { componentFeatureId, isComponentIndex } from '@zhin.js/component';
import {
  formatDisplayPath,
  looksLikeAbsolutePath,
} from '@zhin.js/logger';
import {
  HttpBodyError,
  httpHostToken,
  readJsonBody,
  dispatchRuntimeConsoleRpc,
  pickRpcReply,
  buildProjectFileTree,
  listEnvFiles,
  readProjectFile,
  saveProjectFile,
  createConsoleEventHub,
  registerConsoleRestPages,
  type ConsoleAgentRuntime,
  type ConsoleEventHub,
  type HttpHost,
  type RuntimeConsolePage,
  type RuntimeEndpointSummary,
} from '@zhin.js/host-http';
import type { ImRuntime, RuntimeMessageEvent } from '@zhin.js/core/runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import {
  runtimeEventPublisherToken,
  type DatabaseHost,
  type PluginNodeSnapshot,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { installInboxMessageRecorder } from './inbox-installer.js';

/**
 * 新 Runtime 的 agent 门面。agent 包在 init 时已向 registry 注册 session tree
 * （create-zhin-agent.ts setSessionTreeRuntime）；模块加载后按请求惰性解析，
 * agent 未安装/未 init 时降级（host-http 返回 503 / 空列表 + note）。
 */
let agentModule: {
  getSessionTreeRuntime?: () => ConsoleAgentRuntime['sessionTree'];
  getAssistantRuntime?: () => {
    engine: import('@zhin.js/host-http').ConsoleScheduleEngine;
  } | null;
  getAgentRuntimeRegistry?: () => {
    getDefault(): { orchestrator?: unknown } | null;
  };
} | null | undefined;

void import('@zhin.js/agent')
  .then((mod) => { agentModule = mod as typeof agentModule; })
  .catch(() => { agentModule = null; });

function createAgentRuntimeResolver(
  projectRoot: string,
  getSnapshot?: () => RuntimeSnapshot | undefined,
): () => ConsoleAgentRuntime | undefined {
  const display = (value: string) => displayConsolePath(value, projectRoot);
  return () => ({
    sessionTree: agentModule?.getSessionTreeRuntime?.() ?? undefined,
    introspection: {
      commands: () => {
        const snap = getSnapshot?.();
        if (!snap) return [];
        const index = snap.projections.get(commandFeatureId);
        if (!isCommandIndex(index)) return [];
        return index.list().map((command) => ({
          pattern: command.name,
          desc: command.description ?? '',
          // source 常为绝对路径；控制台展示遵循 workspace→./…、HOME→~/…
          plugin: display(command.source),
        }));
      },
      bindings: () => listIntrospectionBindings(projectRoot),
      tools: () => {
        // 静态目录（snapshot ToolIndex，约定式 tools/*.ts）+ orchestrator 回合内装载的实时工具（去重）
        const seen = new Map<string, Record<string, unknown>>();
        const snap = getSnapshot?.();
        if (snap) {
          for (const [feature, projection] of snap.projections) {
            // 只取 Tool Feature（zhin.agent-tool / 同族），排除 AdapterIndex 等同样带 list() 的投影
            if (!String(feature).includes('tool')) continue;
            if (!isToolIndexLike(projection)) continue;
            for (const tool of projection.list()) {
              if (tool.hidden) continue;
              seen.set(tool.name, {
                name: tool.name,
                source: display(tool.source),
                description: tool.description ?? '',
              });
            }
          }
        }
        const orchestrator = resolveOrchestrator();
        if (orchestrator) {
          for (const tool of orchestrator.tools.getAll()) {
            if ((tool as { hidden?: boolean }).hidden || seen.has(tool.name)) continue;
            seen.set(tool.name, {
              name: tool.name,
              source: 'agent',
              description: (tool as { description?: string }).description ?? '',
            });
          }
        }
        return [...seen.values()];
      },
      mcp: () => {
        const rows = new Map<string, Record<string, unknown>>();
        // 配置面（ai.mcpServers）始终可见；连接状态在 orchestrator 可用时补
        for (const entry of listConfigMcpServers(projectRoot)) {
          rows.set(entry.name, { name: entry.name, connected: false, toolCount: 0, transport: entry.transport });
        }
        const orchestrator = resolveOrchestrator();
        if (orchestrator) {
          for (const entry of orchestrator.mcps.getAll()) {
            rows.set(entry.name, {
              name: entry.name,
              connected: orchestrator.mcps.isConnected(entry.name),
              toolCount: orchestrator.mcps.getToolsFromServer(entry.name).length,
            });
          }
        }
        return { rows: [...rows.values()] };
      },
    },
  });
}

/**
 * Console 返回给前端的路径字段：项目根内 → `./…`，HOME 内 → `~/…`。
 * 逻辑名（`agent` / `builtin`）与相对虚路径原样返回，避免 path.resolve 误伤。
 */
export function displayConsolePath(value: string, projectRoot: string): string {
  if (!value || !looksLikeAbsolutePath(value)) return value;
  return formatDisplayPath(value, { projectRoot });
}

function resolveOrchestrator(): {
  tools: { getAll(): { name: string; hidden?: boolean; description?: string }[] };
  mcps: {
    getAll(): { name: string }[];
    isConnected(name: string): boolean;
    getToolsFromServer(name: string): readonly unknown[];
  };
} | null {
  try {
    const registry = agentModule?.getAgentRuntimeRegistry?.();
    const orchestrator = registry?.getDefault?.()?.orchestrator;
    return (orchestrator as never) ?? null;
  } catch {
    return null;
  }
}

function isToolIndexLike(value: unknown): value is {
  list(): { name: string; description?: string; source: string; hidden?: boolean }[];
} {
  return !!value && typeof value === 'object' && typeof (value as { list?: unknown }).list === 'function';
}

function listConfigMcpServers(projectRoot: string): { name: string; transport?: string }[] {
  const file = findConfigFileSync(projectRoot);
  if (!file) return [];
  try {
    const text = readFileSync(file, 'utf8');
    const doc = (file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)) as Record<string, unknown>;
    const servers = (doc?.ai as { mcpServers?: { name?: string; transport?: string }[] } | undefined)?.mcpServers;
    if (!Array.isArray(servers)) return [];
    return servers
      .filter((entry) => entry && typeof entry.name === 'string')
      .map((entry) => ({ name: entry.name as string, transport: entry.transport }));
  } catch {
    return [];
  }
}

function listIntrospectionBindings(projectRoot: string): Record<string, unknown>[] {
  const file = findConfigFileSync(projectRoot);
  if (!file) return [];
  try {
    const text = readFileSync(file, 'utf8');
    const doc = (file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)) as Record<string, unknown>;
    const agents = (doc?.ai as { agents?: Record<string, {
      provider?: string; model?: string; nickname?: string; mcpServers?: string[];
    }> } | undefined)?.agents;
    if (!agents || typeof agents !== 'object') return [];
    return Object.entries(agents).map(([name, binding]) => ({
      name,
      provider: binding?.provider ?? '-',
      model: binding?.model ?? '-',
      mcpServers: binding?.mcpServers ?? [],
      hasAgentFile: false,
    }));
  } catch {
    return [];
  }
}

function findConfigFileSync(projectRoot: string): string | undefined {
  for (const candidate of [
    'config.yml', 'config.yaml', 'config.json', 'zhin.config.yml', 'zhin.config.yaml',
  ]) {
    const file = join(projectRoot, candidate);
    if (existsSync(file)) return file;
  }
  return undefined;
}

const publicAccess = Object.freeze({ permissions: [] as string[], roles: [] as string[] });

/** 已挂消息桥的 ImRuntime（installResources 按 generation 重跑，订阅只挂一次）。 */
const messageBridgeInstallations = new WeakSet<ImRuntime>();

/**
 * ImRuntime 消息事件 → SSE 事件映射（对齐 console 前端消费形态；
 * content 只发截断预览，不发完整原始段）。
 */
export function publishMessageEvent(hub: ConsoleEventHub, event: RuntimeMessageEvent): void {
  // CapabilityId 形如 `${owner}\0${feature}\0${localName}`；localName 即 endpoint 槽名。
  const localName = String(event.adapter).split('\0').pop() ?? String(event.adapter);
  if (event.direction === 'inbound') {
    const data = {
      direction: 'inbound' as const,
      adapter: localName,
      endpoint: localName,
      sender: event.sender,
      target: event.target,
      content: event.contentPreview,
      messageId: event.messageId,
      timestamp: event.timestamp,
    };
    hub.publish('endpoint:message', data);
    hub.publish('message.receive', data);
    return;
  }
  hub.publish('message.receive', {
    direction: 'outbound' as const,
    adapter: localName,
    endpoint: localName,
    requester: event.requester,
    target: event.target,
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
  /** ScheduleHost — wires `schedule:list`/`cron:list` extended RPC. */
  readonly scheduleHost?: unknown;
  /** Full-scope `system:restart` — typically `process.exit(51)` for CLI daemon. */
  readonly onRestart?: () => void;
  /** Shared console event hub (`hmr:reload` 等由 RootHost 层 publish）。 */
  readonly eventHub?: ConsoleEventHub;
}): RootResourceInstaller {
  const apiBase = normalizeBase(options.apiBase ?? '/api');
  return ({ resources }) => {
    const http = resources.use(httpHostToken);
    // Console SSE hub 同时作为 Root 级事件发布口（插件经 runtimeEventPublisherToken
    // publish endpoint:request/endpoint:notice 等收件箱事件）。
    const hub = options.eventHub ?? createConsoleEventHub();
    resources.provide(runtimeEventPublisherToken, hub);
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
    getAgentRuntime: createAgentRuntimeResolver(projectRoot, snapshot),
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
      const endpointRows = im?.listEndpoints() ?? [];
      const plugins = listSnapshotPlugins(snap)
        .map((node) => buildPluginListItem(node, snap, endpointRows));
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

  http.route('POST', `${base}/console/request`, async (request, response, _url, authScope) => {
    try {
      const message = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
      const payloads = await dispatchRuntimeConsoleRpc(message, {
        authScope,
        listPages: () => listPages(consoleRuntime),
        readConfigYaml: () => readProjectConfigYaml(projectRoot),
        // Flattened view: host keys + plugins.<key>，与 Console 表单/legacy config:get 对齐
        readConfigDocument: () => readConsoleConfigDocument(projectRoot),
        writeConfigYaml: (yaml) => writeProjectConfigYaml(projectRoot, yaml),
        setConfigKey: (pluginName, data) => setProjectConfigKey(projectRoot, pluginName, data),
        listProjectFiles: () => buildProjectFileTree(projectRoot),
        readProjectFile: (filePath) => readProjectFile(projectRoot, filePath),
        saveProjectFile: (filePath, content) => saveProjectFile(projectRoot, filePath, content),
        listEnvFiles: () => listEnvFiles(projectRoot),
        readEnvFile: (filename) => readEnvFile(projectRoot, filename),
        writeEnvFile: (filename, content) => writeEnvFile(projectRoot, filename, content),
        getSchema: (pluginName) => readPluginSchema(projectRoot, pluginName),
        getAllSchemas: () => readAllPluginSchemas(projectRoot),
        listEndpoints: im
          ? async () => im.listEndpoints()
          : undefined,
        getEndpoint: im
          ? async (adapter, endpointId) => im.getEndpoint(adapter, endpointId)
          : undefined,
        sendEndpointMessage: im
          ? async (input) => im.sendEndpointMessage(input)
          : undefined,
        requestRestart: onRestart
          ? () => { onRestart(); }
          : undefined,
        dbInfo: databaseHost
          ? () => ({
            dialect: databaseHost.dialect,
            connected: databaseHost.started,
            tables: databaseHost.tables().length,
          })
          : undefined,
        dbTables: databaseHost
          ? () => databaseHost.tables()
          : undefined,
        database: databaseHost?.console,
        extended: {
          projectRoot,
          scheduleHost,
          resolveEndpoint: im
            ? (adapter, endpointId) => im.getLiveEndpoint(adapter, endpointId)
            : undefined,
          databaseHost: databaseHost
            ? { models: databaseHost.models }
            : undefined,
          resolveScheduleEngine: () => agentModule?.getAssistantRuntime?.()?.engine ?? null,
        },
        listPluginKeys: () => listConsoleConfigKeys(projectRoot),
        publishEvent: (type, data) => hub.publish(type, data),
      });
      const match = pickRpcReply(message, payloads);
      if (!match) {
        writeJson(response, 500, { success: false, error: 'No response' });
        return;
      }
      if (match.error) {
        writeJson(response, 400, {
          success: false,
          error: match.error,
          requestId: match.requestId,
        });
        return;
      }
      writeJson(response, 200, {
        success: true,
        data: match.data,
        type: match.type,
        requestId: match.requestId,
      });
    } catch (error) {
      if (error instanceof HttpBodyError) {
        writeJson(response, error.statusCode, { success: false, error: error.message });
        return;
      }
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Console RPC',
    tags: ['console'],
    description: 'Plugin Runtime Console request envelope: `{ type, data?, requestId? }`.',
  });

  http.route('GET', `${base}/events`, async (request, response, url) => {
    const pages = await listPages(consoleRuntime);
    const lastEventId = url.searchParams.get('last-event-id')
      ?? url.searchParams.get('lastEventId');
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    writeSse(response, 'sync', { key: 'pages', value: pages }, lastEventId ? undefined : '1');
    writeSse(response, 'init-data', { timestamp: Date.now() }, '2');
    const unsubscribe = hub.subscribe(response);
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

  // Assistant Event Ingress (M2) — needs Agent Host setAssistantRuntime.
  http.route('POST', `${base}/assistant/events`, async (request, response) => {
    const agent = await loadAgentConsoleApi();
    if (!agent?.isAssistantEventsEndpointActive()) {
      writeJson(response, 404, { success: false, error: 'assistant.events is not enabled' });
      return;
    }
    const runtime = agent.getAssistantRuntime();
    if (!runtime?.ingress) {
      writeJson(response, 503, { success: false, error: 'assistant runtime unavailable' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const result = await runtime.ingress.handle(body);
      if (!result.ok) {
        const status = result.error?.includes('rate limit') ? 429
          : result.error?.includes('not found') ? 404
            : 400;
        writeJson(response, status, { success: false, error: result.error, data: result });
        return;
      }
      writeJson(response, result.deduped ? 200 : 202, { success: true, data: result });
    } catch (error) {
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Assistant event ingress',
    tags: ['assistant'],
  });

  http.route('GET', `${base}/assistant/jobs`, async (_request, response) => {
    const agent = await loadAgentConsoleApi();
    const runtime = agent?.getAssistantRuntime();
    if (!runtime?.config.enabled) {
      writeJson(response, 404, { success: false, error: 'assistant.enabled is false' });
      return;
    }
    try {
      const jobs = await runtime.engine.listJobs();
      writeJson(response, 200, {
        success: true,
        data: {
          jobs,
          eventsActive: agent?.isAssistantEventsActive(runtime.config) ?? false,
        },
      });
    } catch (error) {
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'List assistant jobs',
    tags: ['assistant'],
  });

  // Orchestration REST — optional peer `@zhin.js/agent` via getOrchestrationRuntime().
  http.route('GET', `${base}/agent/orchestration/runs`, async (_request, response, url) => {
    const sessionKey = url.searchParams.get('sessionKey') ?? '';
    if (!sessionKey) {
      writeJson(response, 400, { success: false, error: '请提供 sessionKey 查询参数' });
      return;
    }
    const runtime = await loadOrchestrationRuntime();
    if (!runtime) {
      writeJson(response, 503, {
        success: false,
        error: 'Orchestration runtime 未就绪（未安装或未初始化 @zhin.js/agent）',
      });
      return;
    }
    const runs = await runtime.listRuns(sessionKey);
    writeJson(response, 200, { success: true, data: { sessionKey, runs } });
  }, {
    summary: 'List orchestration runs',
    tags: ['agent', 'orchestration'],
  });

  http.route('GET', `${base}/agent/orchestration/runs/*`, async (_request, response, url) => {
    const prefix = `${base}/agent/orchestration/runs/`;
    const runId = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/\/+$/u, '')
      : '';
    if (!runId || runId.includes('/')) {
      writeJson(response, 404, { success: false, error: 'Run not found' });
      return;
    }
    const runtime = await loadOrchestrationRuntime();
    if (!runtime) {
      writeJson(response, 503, {
        success: false,
        error: 'Orchestration runtime 未就绪（未安装或未初始化 @zhin.js/agent）',
      });
      return;
    }
    const snapshot = await runtime.getRun(runId);
    if (!snapshot) {
      writeJson(response, 404, { success: false, error: `Run ${runId} 不存在` });
      return;
    }
    writeJson(response, 200, { success: true, data: snapshot });
  }, {
    summary: 'Get orchestration run',
    tags: ['agent', 'orchestration'],
  });
}

async function listPages(consoleRuntime: ConsoleRuntime): Promise<readonly RuntimeConsolePage[]> {
  const pages = await consoleRuntime.runView(publicAccess, (catalog) => catalog.pages());
  return Object.freeze(pages.map((page) => Object.freeze({
    id: page.id,
    localName: page.localName,
    title: page.title,
    route: page.route,
    module: page.module,
    order: page.order,
    hash: page.hash,
  })));
}

/** Console shell entry shape (`@zhin.js/contract` ConsoleClientEntry 兼容）。 */
export type ConsoleEntryBody = {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly module: string;
  readonly resolvedModule: string;
  readonly order: number;
  readonly enabled: boolean;
  readonly meta: { readonly name: string };
  readonly route: string;
  readonly hash: string;
};

export type ConsoleEntriesBody = {
  readonly entries: readonly ConsoleEntryBody[];
  readonly runtimeEnvHint: 'development' | 'production';
};

/**
 * 映射 Console catalog pages → `GET /entries` 响应（legacy host-api 对齐）。
 * SDK `loadConsoleEntries` 消费 `{ entries, runtimeEnvHint }`，动态 import
 * 每项的 `resolvedModule`（`/assets/client/*` 由 Console Host 静态服务）。
 */
export function buildConsoleEntriesBody(
  pages: readonly RuntimeConsolePage[],
  runtimeEnvHint: 'development' | 'production' = defaultRuntimeEnvHint(),
): ConsoleEntriesBody {
  const entries = [...pages]
    .sort((a, b) => a.order - b.order)
    .map((page) => Object.freeze({
      id: page.localName,
      name: page.localName,
      title: page.title,
      module: page.module,
      resolvedModule: page.module,
      order: page.order,
      enabled: true,
      meta: Object.freeze({ name: page.title }),
      route: page.route,
      hash: page.hash,
    }));
  return Object.freeze({ entries: Object.freeze(entries), runtimeEnvHint });
}

function defaultRuntimeEnvHint(): 'development' | 'production' {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
    ? 'production'
    : 'development';
}

export type SystemOsMemory = {
  readonly freeMem: number;
  readonly totalMem: number;
};

/** `GET /api/system/status` 的 data（legacy host-api system-routes 对齐）。 */
export type SystemStatusData = {
  readonly uptime: number;
  readonly memory: NodeJS.MemoryUsage | Record<string, number>;
  readonly osMemory?: SystemOsMemory;
  readonly cpu?: { readonly user: number; readonly system: number };
  readonly platform: string;
  readonly nodeVersion?: string;
  readonly runtime: 'node' | 'unknown';
  readonly pid?: number;
  readonly timestamp: string;
};

/** Host (Node) 系统状态快照 — 移植自 legacy rest/system-routes.ts。 */
export function getSystemStatusData(): SystemStatusData {
  if (typeof process !== 'undefined' && process.versions?.node) {
    return {
      uptime: process.uptime(),
      memory: safeProcessMemory(),
      osMemory: safeOsMemory(),
      cpu: safeProcessCpu(),
      platform: process.platform,
      nodeVersion: process.version,
      runtime: 'node',
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    uptime: 0,
    memory: {},
    platform: 'unknown',
    runtime: 'unknown',
    timestamp: new Date().toISOString(),
  };
}

function safeProcessMemory(): NodeJS.MemoryUsage | Record<string, number> {
  try {
    return process.memoryUsage();
  } catch {
    return {};
  }
}

function safeProcessCpu(): { user: number; system: number } | undefined {
  try {
    return typeof process.cpuUsage === 'function' ? process.cpuUsage() : undefined;
  } catch {
    return undefined;
  }
}

function safeOsMemory(): SystemOsMemory | undefined {
  try {
    return { freeMem: os.freemem(), totalMem: os.totalmem() };
  } catch {
    return undefined;
  }
}

/** `GET /api/stats` 的 data（legacy host-rest-api 对齐；commands/components 暂无新 Runtime 数据源，省略）。 */
export type ConsoleStatsData = {
  readonly plugins: { readonly total: number; readonly active: number };
  readonly endpoints: { readonly total: number; readonly online: number };
  readonly uptime: number;
  /** heapUsed，单位 MB（legacy 契约，dashboard 直接 toFixed 展示）。 */
  readonly memory: number;
  readonly runtime: 'node' | 'unknown';
};

export function buildConsoleStats(
  pluginCount: number,
  endpoints: readonly Pick<RuntimeEndpointSummary, 'status'>[],
): ConsoleStatsData {
  const status = getSystemStatusData();
  const heapUsed = typeof status.memory.heapUsed === 'number' ? status.memory.heapUsed : 0;
  return {
    plugins: { total: pluginCount, active: pluginCount },
    endpoints: {
      total: endpoints.length,
      online: endpoints.filter((endpoint) => endpoint.status === 'online').length,
    },
    uptime: status.uptime,
    memory: heapUsed / 1024 / 1024,
    runtime: status.runtime,
  };
}

/** Console 卡片单条 Feature 分组（对齐 legacy FeatureJSON）。 */
export type ConsolePluginFeature = {
  readonly name: string;
  readonly icon: string;
  readonly desc: string;
  readonly count: number;
  readonly items: readonly { readonly name: string; readonly desc?: string }[];
};

/**
 * listEndpoints 返回形态：无 owner，用 adapter 平台类型（`@scope/adapter-icqq` → `icqq`）归属插件。
 * 与 ImRuntime.listEndpoints / RuntimeEndpointSummary 对齐。
 */
export type ConsoleEndpointHint = {
  readonly name: string;
  readonly adapter: string;
  readonly connected: boolean;
};

/** `GET /api/plugins` 列表项（legacy buildPluginListItem 对齐）。 */
export type ConsolePluginListItem = {
  readonly name: string;
  readonly status: 'active' | 'inactive';
  readonly description: string;
  readonly features: readonly ConsolePluginFeature[];
  readonly packageName: string;
  readonly instanceKey: string;
};

export function buildPluginListItem(
  node: PluginNodeSnapshot,
  snapshot?: RuntimeSnapshot,
  endpoints?: readonly ConsoleEndpointHint[],
): ConsolePluginListItem {
  return {
    name: node.instanceKey,
    // Snapshot 中的节点均为当前 generation 已加载插件。
    status: 'active',
    description: node.metadata?.displayName ?? node.packageName,
    features: buildPluginFeatures(node, snapshot, endpoints),
    packageName: node.packageName,
    instanceKey: node.instanceKey,
  };
}

/**
 * Console 卡片 Feature 分组（icon 与 legacy Feature 类 / 前端 iconMap 对齐）。
 * key = FeatureId 字符串（capability.feature）。
 */
const FEATURE_GROUPS: Record<string, { name: string; icon: string; desc: string }> = {
  'zhin.adapter': { name: 'adapter', icon: 'Cable', desc: '适配器' },
  'zhin.command': { name: 'command', icon: 'Terminal', desc: '命令' },
  'zhin.component': { name: 'component', icon: 'Box', desc: '组件' },
  'zhin.middleware': { name: 'middleware', icon: 'Layers', desc: '中间件' },
  'zhin.agent-tool': { name: 'tool', icon: 'Wrench', desc: '工具' },
  'zhin.skill': { name: 'skill', icon: 'Brain', desc: '技能' },
  'zhin.agent': { name: 'agent', icon: 'Bot', desc: 'Agent' },
  'zhin.mcp': { name: 'mcp', icon: 'Plug', desc: 'MCP' },
  'zhin.page': { name: 'page', icon: 'Layout', desc: '页面' },
  'zhin.layout': { name: 'layout', icon: 'PanelTop', desc: '布局' },
};

/** 从 snapshot.capabilities 按 owner 聚合插件 Feature（对齐 legacy Feature.toJSON）。 */
export function buildPluginFeatures(
  node: PluginNodeSnapshot,
  snapshot?: RuntimeSnapshot,
  endpoints?: readonly ConsoleEndpointHint[],
): readonly ConsolePluginFeature[] {
  if (!snapshot) return Object.freeze([]);
  const groups = new Map<string, {
    name: string;
    icon: string;
    desc: string;
    items: { name: string; desc?: string }[];
  }>();
  for (const slot of snapshot.capabilities.values()) {
    if (slot.owner !== node.id) continue;
    const group = FEATURE_GROUPS[String(slot.feature)];
    if (!group) continue;
    const entry = groups.get(group.name) ?? { ...group, items: [] };
    entry.items.push({ name: slot.localName });
    groups.set(group.name, entry);
  }
  // adapter Feature 的 items 用真实 endpoint 名（uin / bot 名）；listEndpoints 无 owner，
  // adapter Feature 的 items 用真实 endpoint 名（uin / bot 名）。
  // 按 endpoint 的 owner PluginId 精确归属实例——不能按平台类型匹配，
  // 否则多实例适配器（icqq×N）的每个实例都会分到全部 endpoint。
  const adapterGroup = groups.get('adapter');
  if (adapterGroup && endpoints) {
    const owned = endpoints.filter((endpoint) =>
      (endpoint as { owner?: string }).owner === node.id);
    if (owned.length > 0) {
      adapterGroup.items = owned.map((endpoint) => ({
        name: endpoint.name,
        desc: endpoint.connected ? 'online' : 'offline',
      }));
    }
  }
  return Object.freeze([...groups.values()].map((group) => Object.freeze({
    name: group.name,
    icon: group.icon,
    desc: group.desc,
    count: group.items.length,
    items: Object.freeze(group.items),
  })));
}

/** `GET /api/plugins/:name` 详情（legacy host-rest-api 对齐）。 */
export type ConsolePluginDetail = ConsolePluginListItem & {
  readonly filename: string;
  readonly filePath: string;
  readonly version?: string;
  readonly contextCount: number;
  readonly contexts: readonly unknown[];
};

export function buildPluginDetail(
  node: PluginNodeSnapshot,
  version?: string,
  snapshot?: RuntimeSnapshot,
  endpoints?: readonly ConsoleEndpointHint[],
  projectRoot?: string,
): ConsolePluginDetail {
  const packageRoot = projectRoot
    ? displayConsolePath(node.packageRoot, projectRoot)
    : node.packageRoot;
  return {
    ...buildPluginListItem(node, snapshot, endpoints),
    filename: packageRoot,
    filePath: packageRoot,
    ...(version ? { version } : {}),
    contextCount: 0,
    contexts: Object.freeze([]),
  };
}

/** Snapshot 中非 root 的插件节点（root 无 parent，对应 legacy root.children）。 */
export function listSnapshotPlugins(snapshot: RuntimeSnapshot | undefined): PluginNodeSnapshot[] {
  if (!snapshot) return [];
  return [...snapshot.tree.values()].filter((node) => node.parent !== undefined);
}

function readSnapshot(accessor?: () => RuntimeSnapshot | undefined): RuntimeSnapshot | undefined {
  try {
    return accessor?.();
  } catch {
    return undefined;
  }
}

async function readPackageVersion(packageRoot: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      readonly version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}


async function readProjectConfigYaml(projectRoot: string): Promise<string> {
  const file = await findConfigFile(projectRoot);
  if (!file) return '';
  return readFile(file, 'utf8');
}

async function readProjectConfigDocument(projectRoot: string): Promise<Record<string, unknown>> {
  const file = await findConfigFile(projectRoot);
  if (!file) return {};
  const text = await readFile(file, 'utf8');
  if (file.endsWith('.json')) {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
  const value = parseYaml(text) as unknown;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Host 级配置键（与 ConfigComposer 对齐）。
 * 这些键在文档顶层；插件配置在 `plugins.<instanceKey>`。
 */
export const HOST_CONFIG_KEYS = Object.freeze([
  'http',
  'database',
  'ai',
  'mcp',
  'a2a',
  'speech',
  'htmlRenderer',
  'assistant',
  'collaboration',
  'log_level',
  'plugin',
] as const);

const HOST_CONFIG_KEY_SET = new Set<string>(HOST_CONFIG_KEYS);

/**
 * Console 视角的扁平配置：
 * - 顶层 host 键（http / database / …）原样
 * - `plugins.<key>` 展开为顶层 `key`（与 legacy `config:get(pluginName)` 契约一致）
 */
export async function readConsoleConfigDocument(
  projectRoot: string,
): Promise<Record<string, unknown>> {
  return flattenConfigDocument(await readProjectConfigDocument(projectRoot));
}

export function flattenConfigDocument(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key === 'plugins') continue;
    flat[key] = value;
  }
  const plugins = document.plugins;
  if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
    for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) {
      // 插件命名空间优先：同名 host 键极少冲突；若冲突以 plugins 为准
      flat[key] = value;
    }
  }
  return flat;
}

/** 配置 Tab 列表：host 键（有值）+ plugins 键 + package.json zhin.plugins。 */
export async function listConsoleConfigKeys(projectRoot: string): Promise<string[]> {
  const document = await readProjectConfigDocument(projectRoot);
  const keys = new Set<string>();
  for (const key of HOST_CONFIG_KEYS) {
    if (key in document) keys.add(key);
  }
  const plugins = document.plugins;
  if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
    for (const key of Object.keys(plugins as Record<string, unknown>)) keys.add(key);
  } else if (Array.isArray(plugins)) {
    for (const item of plugins) keys.add(String(item));
  }
  for (const key of (await readPluginPackageMap(projectRoot)).keys()) keys.add(key);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

async function findConfigFile(projectRoot: string): Promise<string | undefined> {
  for (const candidate of [
    'config.yml', 'config.yaml', 'config.json', 'zhin.config.yml', 'zhin.config.yaml',
  ]) {
    const file = join(projectRoot, candidate);
    try {
      await access(file);
      return file;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

async function ensureConfigFile(projectRoot: string): Promise<string> {
  const existing = await findConfigFile(projectRoot);
  if (existing) return existing;
  return join(projectRoot, 'zhin.config.yml');
}

async function writeProjectConfigYaml(projectRoot: string, yaml: string): Promise<void> {
  const file = await ensureConfigFile(projectRoot);
  await writeFile(file, yaml, 'utf8');
}

/**
 * 写入配置键：
 * - host 键 / 已在顶层的键 → 顶层
 * - 其余（插件 instanceKey）→ `plugins.<name>`
 */
export async function setProjectConfigKey(
  projectRoot: string,
  pluginName: string,
  data: unknown,
): Promise<{ restartRequired: boolean }> {
  const file = await ensureConfigFile(projectRoot);
  const document = await readProjectConfigDocument(projectRoot);
  writeConfigKey(document, pluginName, data);
  if (file.endsWith('.json')) {
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  } else {
    await writeFile(file, stringifyYaml(document), 'utf8');
  }
  return { restartRequired: true };
}

export function writeConfigKey(
  document: Record<string, unknown>,
  key: string,
  data: unknown,
): void {
  const plugins = document.plugins;
  const pluginsIsObject = plugins
    && typeof plugins === 'object'
    && !Array.isArray(plugins);
  const inPlugins = pluginsIsObject
    && Object.prototype.hasOwnProperty.call(plugins, key);

  // Host 键或非 plugins 命名空间的顶层键写顶层；其余写 plugins.<key>
  if (HOST_CONFIG_KEY_SET.has(key) || (key in document && key !== 'plugins' && !inPlugins)) {
    document[key] = data;
    return;
  }
  // plugins: [] (array form) must not be clobbered into an object — promote
  // to a map while preserving previously listed bare names as empty objects.
  let bucket: Record<string, unknown>;
  if (pluginsIsObject) {
    bucket = plugins as Record<string, unknown>;
  } else if (Array.isArray(plugins)) {
    bucket = {};
    for (const item of plugins) {
      const name = String(item);
      if (name && !(name in bucket)) bucket[name] = {};
    }
  } else {
    bucket = {};
  }
  bucket[key] = data;
  document.plugins = bucket;
}

const ENV_FILES = new Set(['.env', '.env.development', '.env.production']);

async function readEnvFile(projectRoot: string, filename: string): Promise<string> {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  const file = join(projectRoot, filename);
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function writeEnvFile(projectRoot: string, filename: string, content: string): Promise<void> {
  if (!ENV_FILES.has(filename)) throw new Error(`Invalid env file: ${filename}`);
  await writeFile(join(projectRoot, filename), content, 'utf8');
}

/**
 * 读取插件 schema.json，并转换为 Console 表单使用的 `@zhin.js/schema` toJSON 形态。
 * `pluginName` 支持 instanceKey（`icqq`）或包名（`@zhin.js/adapter-icqq`）。
 */
export async function readPluginSchema(
  projectRoot: string,
  pluginName?: string,
): Promise<unknown> {
  if (!pluginName) return null;
  if (HOST_CONFIG_KEY_SET.has(pluginName)) {
    // Host 键无插件 schema.json；返回宽松 object，避免表单空白
    return jsonSchemaToConsoleSchema({ type: 'object', additionalProperties: true });
  }
  const raw = await loadRawPluginSchemaJson(projectRoot, pluginName);
  if (raw == null) return null;
  return jsonSchemaToConsoleSchema(raw);
}

async function loadRawPluginSchemaJson(
  projectRoot: string,
  pluginName: string,
): Promise<unknown> {
  const candidates: string[] = [
    join(projectRoot, 'node_modules', pluginName, 'schema.json'),
  ];
  const packageName = (await readPluginPackageMap(projectRoot)).get(pluginName);
  if (packageName && packageName !== pluginName) {
    candidates.push(join(projectRoot, 'node_modules', packageName, 'schema.json'));
  }
  // 本地 workspace 插件（package.json 里没映射时，按常见 plugins/* 路径尝试无意义；仅 node_modules）
  for (const file of candidates) {
    try {
      const text = await readFile(file, 'utf8');
      return JSON.parse(text) as unknown;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * JSON Schema (draft-2020 / 插件 schema.json) → Console Schema JSON
 * （`@zhin.js/schema` `toJSON()`：`{ type, object?, list?, inner?, key?, description?, ... }`）。
 *
 * Remote Console 表单按该形态渲染；直接返回 JSON Schema 会导致字段无法展开。
 */
export function jsonSchemaToConsoleSchema(
  input: unknown,
  key?: string,
): Record<string, unknown> | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  const schema = input as Record<string, unknown>;

  // 已是 Console Schema 形态则透传；勿把 JSON Schema 的 enum/integer/properties 误判为已转换
  if (isConsoleSchemaJson(schema)) {
    return key && schema.key == null ? { ...schema, key } : { ...schema };
  }

  const typeField = schema.type;
  const description = typeof schema.description === 'string' ? schema.description : undefined;
  const defaultValue = schema.default;
  const requiredFlag = schema.required === true ? true : undefined;

  // type: ["string","number"] → union of scalars
  if (Array.isArray(typeField)) {
    const list = typeField
      .filter((t): t is string => typeof t === 'string')
      .map((t) => jsonSchemaToConsoleSchema({ type: t }, undefined))
      .filter((s): s is Record<string, unknown> => s != null);
    return compactMeta({
      type: 'union',
      key,
      description,
      default: defaultValue,
      list,
    });
  }

  const type = typeof typeField === 'string' ? typeField : inferJsonSchemaType(schema);

  if (type === 'object' || schema.properties != null) {
    const properties = (schema.properties && typeof schema.properties === 'object'
      && !Array.isArray(schema.properties))
      ? schema.properties as Record<string, unknown>
      : {};
    const requiredList = Array.isArray(schema.required)
      ? new Set(schema.required.map(String))
      : new Set<string>();
    const object: Record<string, unknown> = {};
    for (const [propKey, propSchema] of Object.entries(properties)) {
      const converted = jsonSchemaToConsoleSchema(propSchema, propKey);
      if (!converted) continue;
      if (requiredList.has(propKey)) converted.required = true;
      object[propKey] = converted;
    }
    // additionalProperties: Schema → dict
    if (
      Object.keys(object).length === 0
      && schema.additionalProperties
      && typeof schema.additionalProperties === 'object'
    ) {
      const inner = jsonSchemaToConsoleSchema(schema.additionalProperties);
      return compactMeta({
        type: 'dict',
        key,
        description,
        default: defaultValue,
        inner: inner ?? { type: 'any' },
      });
    }
    // Dual-emit: @zhin.js/schema toJSON uses `object`; PluginConfigForm nested
    // renderers historically read `dict` / `properties`. Emit all three so list
    // item forms (endpoints[]) can expand fields and support add/remove.
    return compactMeta({
      type: 'object',
      key,
      description,
      default: defaultValue,
      required: requiredFlag,
      object,
      properties: object,
      dict: object,
    });
  }

  if (type === 'array') {
    const items = schema.items;
    const inner = Array.isArray(items)
      ? { type: 'any' as const }
      : (jsonSchemaToConsoleSchema(items) ?? { type: 'any' });
    return compactMeta({
      type: 'list',
      key,
      description,
      default: defaultValue,
      required: requiredFlag,
      inner,
      ...(Array.isArray(schema.enum)
        ? { options: schema.enum.map((value) => ({ label: String(value), value })) }
        : {}),
    });
  }

  // enum on scalar → options
  const options = Array.isArray(schema.enum)
    ? schema.enum.map((value) => ({ label: String(value), value }))
    : undefined;

  const mappedType = type === 'integer' ? 'number' : (type ?? 'any');
  return compactMeta({
    type: mappedType,
    key,
    description,
    default: defaultValue,
    required: requiredFlag,
    min: typeof schema.minimum === 'number' ? schema.minimum : undefined,
    max: typeof schema.maximum === 'number' ? schema.maximum : undefined,
    options,
  });
}

/** Console Schema JSON（@zhin.js/schema toJSON）vs 插件 schema.json（JSON Schema）。 */
function isConsoleSchemaJson(schema: Record<string, unknown>): boolean {
  if (schema.object != null || schema.list != null || schema.inner != null) return true;
  // Console-only types
  if (typeof schema.type === 'string'
    && ['dict', 'union', 'tuple', 'intersect', 'const', 'any', 'date', 'regexp'].includes(schema.type)) {
    return true;
  }
  // JSON Schema markers → not Console Schema
  if (
    schema.properties != null
    || schema.items != null
    || schema.$schema != null
    || schema.additionalProperties != null
    || schema.anyOf != null
    || schema.oneOf != null
    || schema.allOf != null
    || schema.enum != null
    || schema.minimum != null
    || schema.maximum != null
    || schema.type === 'integer'
    || Array.isArray(schema.type)
  ) {
    return false;
  }
  // Bare Console scalar e.g. { type: 'string', key: 'name', description: '…' }
  return typeof schema.type === 'string';
}

function inferJsonSchemaType(schema: Record<string, unknown>): string | undefined {
  if (schema.properties != null) return 'object';
  if (schema.items != null) return 'array';
  if (schema.enum != null) return typeof schema.enum === 'object'
    && Array.isArray(schema.enum)
    && schema.enum.length > 0
    ? typeof schema.enum[0]
    : 'string';
  return undefined;
}

function compactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined),
  );
}

/** instanceKey → package 映射（来自项目 package.json 的 `zhin.plugins`）。 */
export async function readPluginPackageMap(
  projectRoot: string,
): Promise<ReadonlyMap<string, string>> {
  const map = new Map<string, string>();
  try {
    const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
      readonly zhin?: { readonly plugins?: unknown };
    };
    const list = pkg.zhin?.plugins;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as { readonly package?: unknown; readonly instanceKey?: unknown };
        if (typeof entry.package !== 'string') continue;
        map.set(String(entry.instanceKey ?? entry.package), entry.package);
      }
    }
  } catch {
    // 无 package.json 或格式不符 — 返回空映射
  }
  return map;
}

export async function readAllPluginSchemas(
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const keys = await listConsoleConfigKeys(projectRoot);
  const schemas: Record<string, unknown> = {};
  for (const key of keys) {
    const schema = await readPluginSchema(projectRoot, key);
    if (schema != null) schemas[key] = schema;
  }
  return schemas;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function writeSse(
  response: ServerResponse,
  type: string,
  data: unknown,
  id?: string,
): void {
  if (id) response.write(`id: ${id}\n`);
  response.write(`event: ${type}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function normalizeBase(value: string): string {
  if (!value.startsWith('/')) return `/${value}`;
  return value.replace(/\/+$/u, '') || '/api';
}

type OrchestrationRuntime = {
  listRuns(sessionKey?: string): Promise<unknown[]>;
  getRun(runId: string): Promise<unknown | null>;
};

type AssistantRuntime = {
  readonly config: { readonly enabled?: boolean };
  readonly ingress?: {
    handle(body: unknown): Promise<{ ok: boolean; deduped?: boolean; error?: string }>;
  };
  readonly engine: { listJobs(): Promise<unknown[]> };
};

type AgentConsoleApi = {
  getAssistantRuntime(): AssistantRuntime | null;
  isAssistantEventsEndpointActive(): boolean;
  isAssistantEventsActive(config: AssistantRuntime['config']): boolean;
};

async function loadAgentConsoleApi(): Promise<AgentConsoleApi | null> {
  try {
    return await import('@zhin.js/agent') as unknown as AgentConsoleApi;
  } catch {
    return null;
  }
}

async function loadOrchestrationRuntime(): Promise<OrchestrationRuntime | null> {
  try {
    const mod = await import('@zhin.js/agent') as {
      getOrchestrationRuntime?: () => OrchestrationRuntime | null;
    };
    return mod.getOrchestrationRuntime?.() ?? null;
  } catch {
    return null;
  }
}
