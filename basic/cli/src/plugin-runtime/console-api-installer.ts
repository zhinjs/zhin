import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import type { ServerResponse } from 'node:http';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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
  type ConsoleEventHub,
  type HttpHost,
  type RuntimeConsolePage,
  type RuntimeEndpointSummary,
} from '@zhin.js/host-http';
import type { ImRuntime, RuntimeMessageEvent } from '@zhin.js/core/runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { DatabaseHost, PluginNodeSnapshot, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { registerConsoleRestPages, type ConsoleAgentRuntime } from '@zhin.js/host-http';

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
} | null | undefined;

void import('@zhin.js/agent')
  .then((mod) => { agentModule = mod as typeof agentModule; })
  .catch(() => { agentModule = null; });

function resolveConsoleAgentRuntime(): ConsoleAgentRuntime | undefined {
  return {
    sessionTree: agentModule?.getSessionTreeRuntime?.() ?? undefined,
    introspection: undefined,
  };
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
      options.eventHub,
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

  // REST 六组（logs / marketplace / introspection / agent sessions 等，host-http 实现）
  registerConsoleRestPages(http, {
    fullScope: true,
    projectRoot,
    getEndpoints: im
      ? () => im.listEndpoints()
      : undefined,
    getAgentRuntime: () => resolveConsoleAgentRuntime(),
    databaseHost: databaseHost
      ? {
        dialect: databaseHost.dialect,
        started: databaseHost.started,
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
      writeJson(response, 200, {
        success: true,
        data: buildConsoleStats(listSnapshotPlugins(readSnapshot(snapshot)).length, endpoints),
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
      const plugins = listSnapshotPlugins(readSnapshot(snapshot)).map(buildPluginListItem);
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
      const node = listSnapshotPlugins(readSnapshot(snapshot))
        .find((item) => item.instanceKey === name || item.packageName === name);
      if (!node) {
        writeJson(response, 404, { success: false, error: '插件不存在' });
        return;
      }
      writeJson(response, 200, {
        success: true,
        data: buildPluginDetail(node, await readPackageVersion(node.packageRoot)),
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
        readConfigDocument: () => readProjectConfigDocument(projectRoot),
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
        listPluginKeys: async () => {
          const document = await readProjectConfigDocument(projectRoot);
          const plugins = document.plugins;
          if (Array.isArray(plugins)) return plugins.map((item) => String(item));
          if (plugins && typeof plugins === 'object') {
            return Object.keys(plugins as Record<string, unknown>);
          }
          return [];
        },
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

/** `GET /api/plugins` 列表项（legacy buildPluginListItem 对齐；features 暂无新 Runtime 数据源，给空数组）。 */
export type ConsolePluginListItem = {
  readonly name: string;
  readonly status: 'active' | 'inactive';
  readonly description: string;
  readonly features: readonly unknown[];
  readonly packageName: string;
  readonly instanceKey: string;
};

export function buildPluginListItem(node: PluginNodeSnapshot): ConsolePluginListItem {
  return {
    name: node.instanceKey,
    // Snapshot 中的节点均为当前 generation 已加载插件。
    status: 'active',
    description: node.metadata?.displayName ?? node.packageName,
    features: Object.freeze([]),
    packageName: node.packageName,
    instanceKey: node.instanceKey,
  };
}

/** `GET /api/plugins/:name` 详情（legacy host-rest-api 对齐）。 */
export type ConsolePluginDetail = ConsolePluginListItem & {
  readonly filename: string;
  readonly filePath: string;
  readonly version?: string;
  readonly contextCount: number;
  readonly contexts: readonly unknown[];
};

export function buildPluginDetail(node: PluginNodeSnapshot, version?: string): ConsolePluginDetail {
  return {
    ...buildPluginListItem(node),
    filename: node.packageRoot,
    filePath: node.packageRoot,
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

async function setProjectConfigKey(
  projectRoot: string,
  pluginName: string,
  data: unknown,
): Promise<{ restartRequired: boolean }> {
  const file = await ensureConfigFile(projectRoot);
  const document = await readProjectConfigDocument(projectRoot);
  document[pluginName] = data;
  if (file.endsWith('.json')) {
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  } else {
    await writeFile(file, stringifyYaml(document), 'utf8');
  }
  return { restartRequired: true };
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

async function readPluginSchema(
  projectRoot: string,
  pluginName?: string,
): Promise<unknown> {
  if (!pluginName) return null;
  const direct = join(projectRoot, 'node_modules', pluginName, 'schema.json');
  try {
    const text = await readFile(direct, 'utf8');
    return JSON.parse(text) as unknown;
  } catch {
    // pluginName 可能是 instanceKey（如 `icqq-2`），经 zhin.plugins 映射到包名再试
  }
  const packageName = (await readPluginPackageMap(projectRoot)).get(pluginName);
  if (!packageName) return null;
  try {
    const text = await readFile(join(projectRoot, 'node_modules', packageName, 'schema.json'), 'utf8');
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** instanceKey → package 映射（来自项目 package.json 的 `zhin.plugins`）。 */
async function readPluginPackageMap(projectRoot: string): Promise<ReadonlyMap<string, string>> {
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

async function readAllPluginSchemas(
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const document = await readProjectConfigDocument(projectRoot);
  const plugins = document.plugins;
  const keys: string[] = [];
  if (Array.isArray(plugins)) keys.push(...plugins.map((item) => String(item)));
  else if (plugins && typeof plugins === 'object') {
    keys.push(...Object.keys(plugins as Record<string, unknown>));
  }
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
