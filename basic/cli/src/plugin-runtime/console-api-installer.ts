import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  type HttpHost,
  type RuntimeConsolePage,
} from '@zhin.js/host-http';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const publicAccess = Object.freeze({ permissions: [] as string[], roles: [] as string[] });

export function installConsoleApi(options: {
  readonly console: ConsoleRuntime;
  readonly projectRoot: string;
  readonly apiBase?: string;
  /** When provided, wires `endpoint.*` RPC to AdapterIndex via ImRuntime. */
  readonly im?: ImRuntime;
  /** When provided, wires `db:info` / `db:tables` RPC to the Database host. */
  readonly databaseHost?: DatabaseHost;
  /** Full-scope `system:restart` — typically `process.exit(51)` for CLI daemon. */
  readonly onRestart?: () => void;
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
): void {
  const base = normalizeBase(apiBase);

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
        listPluginKeys: async () => {
          const document = await readProjectConfigDocument(projectRoot);
          const plugins = document.plugins;
          if (Array.isArray(plugins)) return plugins.map((item) => String(item));
          if (plugins && typeof plugins === 'object') {
            return Object.keys(plugins as Record<string, unknown>);
          }
          return [];
        },
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
    const timer = setInterval(() => {
      try {
        response.write(': keepalive\n\n');
      } catch {
        clearInterval(timer);
      }
    }, 15_000);
    request.once('close', () => {
      clearInterval(timer);
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
