/**
 * Console REST pages — logs / marketplace / introspection / agent sessions。
 *
 * 响应形状对齐 legacy `packages/host/api/src/rest/`：
 * - logs-rest-api.ts（SystemLog 模型）
 * - marketplace-rest-api.ts（plugins.json + npmmirror）
 * - introspection-rest-api.ts（分页内省列表）
 * - agent-sessions-rest-api.ts（ADR 0010 D3 session tree）
 *
 * 数据源不可用时降级：读操作返回空数组 + `note` 说明，session tree 返回 503；
 * 写操作要求 `ctx.fullScope && authScope === 'full'`，否则 403。
 */
import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HttpHost } from './http-host.js';
import { HttpBodyError, readJsonBody } from './json-body.js';
import type { AuthScope } from './token-registry.js';

/** 与 basic/cli 接线方对齐的上下文约定。 */
export interface ConsoleRestCtx {
  /** false = demo 部署：只读 GET 放行，写操作一律 403。 */
  readonly fullScope: boolean;
  readonly projectRoot: string;
  readonly getEndpoints?: () => readonly {
    name: string;
    adapter: string;
    connected: boolean;
    status: string;
  }[];
  /**
   * 可选：返回新 Runtime 的 agent 门面（见 {@link ConsoleAgentRuntime}）。
   * 未接线时 introspection 降级为空列表 + note，session tree 返回 503。
   */
  readonly getAgentRuntime?: () => unknown;
  /** Database host（logs 页数据源：SystemLog 模型）。 */
  readonly databaseHost?: {
    readonly dialect: string;
    readonly started: boolean;
    readonly models: { get(name: string): unknown };
  };
}

/** 内省数据门面 — 由 basic/cli 用 agent 包 collectIntrospection* 装配。 */
export interface ConsoleAgentIntrospection {
  commands?(): readonly unknown[];
  bindings?(): readonly unknown[];
  tools?(): readonly unknown[];
  mcp?(): { rows: readonly unknown[]; note?: string } | readonly unknown[];
}

/** Session tree 门面 — 形状对齐 agent 包 SessionTreeRuntimeHandle。 */
export interface ConsoleAgentSessionTree {
  resolveActiveSessionId(sessionKey: string): Promise<string | null>;
  agentSessionStore: {
    getBySessionId(sessionId: string): Promise<
      { active_leaf_message_id?: number | null } | null | undefined
    >;
  };
  listBranchPoints(sessionId: string): Promise<readonly unknown[]>;
  switchActiveLeaf(sessionId: string, messageId: number): Promise<boolean>;
  jumpToBranchIndex(
    sessionId: string,
    index: number,
  ): Promise<{ ok: boolean; message: string }>;
}

/** `ctx.getAgentRuntime()` 返回值的最小结构约定（全部可选，逐项降级）。 */
export interface ConsoleAgentRuntime {
  readonly introspection?: ConsoleAgentIntrospection;
  readonly sessionTree?: ConsoleAgentSessionTree;
}

export interface ConsoleRestPagesOptions {
  /** 默认 `/api`。 */
  readonly apiBase?: string;
  /** 测试注入用；默认全局 fetch。 */
  readonly fetchFn?: typeof fetch;
  /** 默认 `https://zhin.js.org/plugins.json`（legacy 同源）。 */
  readonly pluginRegistryUrl?: string;
  /** 默认 `https://registry.npmmirror.com`（legacy 同源）。 */
  readonly npmRegistryUrl?: string;
}

type LogModelLike = {
  select(...fields: string[]): LogSelectionLike;
  delete(where: Record<string, unknown>): Promise<unknown>;
};

type LogSelectionLike = PromiseLike<LogRow[]> & {
  where(where: Record<string, unknown>): LogSelectionLike;
  orderBy(field: string, direction: 'ASC' | 'DESC'): LogSelectionLike;
  limit(count: number): Promise<LogRow[]>;
};

type LogRow = {
  id?: unknown;
  level?: string;
  name?: string;
  message?: string;
  source?: string;
  timestamp?: string | Date;
};

const INTROSPECTION_PAGE_SIZES = {
  commands: 25,
  tools: 15,
  endpoints: 30,
  bindings: 30,
  mcp: 30,
} as const;

type IntrospectionKind = keyof typeof INTROSPECTION_PAGE_SIZES;

let pluginsCache: { data: unknown[]; ts: number } | null = null;
const PLUGINS_CACHE_TTL = 5 * 60 * 1000;

/**
 * 注册 Console 页面 REST 路由。返回注销函数（注销全部已注册路由）。
 */
export function registerConsoleRestPages(
  host: HttpHost,
  ctx: ConsoleRestCtx,
  options: ConsoleRestPagesOptions = {},
): () => void {
  const base = normalizeBase(options.apiBase ?? '/api');
  const fetchFn = options.fetchFn ?? fetch;
  const pluginRegistryUrl = options.pluginRegistryUrl ?? 'https://zhin.js.org/plugins.json';
  const npmRegistryUrl = (options.npmRegistryUrl ?? 'https://registry.npmmirror.com')
    .replace(/\/+$/u, '');
  const disposers: Array<() => void> = [];
  const route: typeof host.route = (method, path, handler, meta) => {
    const dispose = host.route(method, path, handler, meta);
    disposers.push(dispose);
    return dispose;
  };

  registerLogsRoutes(route, base, ctx);
  registerMarketplaceRoutes(route, base, ctx, fetchFn, pluginRegistryUrl, npmRegistryUrl);
  registerIntrospectionRoutes(route, base, ctx);
  registerAgentSessionRoutes(route, base, ctx);

  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}

// ---------------------------------------------------------------------------
// logs（legacy logs-rest-api.ts；数据源 SystemLog 模型）
// ---------------------------------------------------------------------------

function registerLogsRoutes(
  route: HttpHost['route'],
  base: string,
  ctx: ConsoleRestCtx,
): void {
  const getModel = (): LogModelLike | null => {
    const host = ctx.databaseHost;
    if (!host?.started) return null;
    try {
      const model = host.models.get('SystemLog') as LogModelLike | null | undefined;
      return model && typeof model.select === 'function' ? model : null;
    } catch {
      return null;
    }
  };
  const unavailableNote = 'SystemLog 模型不可用（Database 未启动或未注册 DatabaseLogTransport）';

  route('GET', `${base}/logs`, async (_request, response, url) => {
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1),
      1000,
    );
    const level = url.searchParams.get('level') ?? undefined;
    const LogModel = getModel();
    if (!LogModel) {
      writeJson(response, 200, { success: true, data: [], total: 0, note: unavailableNote });
      return;
    }

    let selection = LogModel.select();
    if (level && level !== 'all') {
      selection = selection.where({ level });
    }

    const logs = await selection.orderBy('timestamp', 'DESC').limit(limit);

    writeJson(response, 200, {
      success: true,
      data: logs.map((log) => ({
        level: log.level,
        name: log.name,
        message: log.message,
        source: log.source,
        timestamp:
          log.timestamp instanceof Date ? log.timestamp.toISOString() : log.timestamp,
      })),
      total: logs.length,
    });
  }, { summary: 'List system logs', tags: ['console', 'logs'] });

  route('DELETE', `${base}/logs`, async (_request, response, _url, authScope) => {
    if (!requireWriteScope(response, ctx, authScope)) return;
    const LogModel = getModel();
    if (LogModel) {
      await LogModel.delete({});
    }
    writeJson(response, 200, { success: true, message: '日志已清空' });
  }, { summary: 'Clear system logs', tags: ['console', 'logs'] });

  route('GET', `${base}/logs/stats`, async (_request, response) => {
    const LogModel = getModel();
    if (!LogModel) {
      writeJson(response, 200, {
        success: true,
        data: {
          total: 0,
          byLevel: { info: 0, warn: 0, error: 0 },
          oldestTimestamp: null,
        },
        note: unavailableNote,
      });
      return;
    }

    const total = await LogModel.select();
    const levels = ['info', 'warn', 'error'];
    const levelCounts: Record<string, number> = {};

    for (const level of levels) {
      const count = await LogModel.select().where({ level });
      levelCounts[level] = count.length;
    }

    const oldestLog = await LogModel.select('timestamp')
      .orderBy('timestamp', 'ASC')
      .limit(1);
    const oldestTimestamp =
      oldestLog.length > 0
        ? oldestLog[0].timestamp instanceof Date
          ? oldestLog[0].timestamp.toISOString()
          : (oldestLog[0].timestamp ?? null)
        : null;

    writeJson(response, 200, {
      success: true,
      data: { total: total.length, byLevel: levelCounts, oldestTimestamp },
    });
  }, { summary: 'System log stats', tags: ['console', 'logs'] });

  route('POST', `${base}/logs/cleanup`, async (request, response, _url, authScope) => {
    if (!requireWriteScope(response, ctx, authScope)) return;
    const LogModel = getModel();
    if (!LogModel) {
      writeJson(response, 200, {
        success: true,
        message: '已清理 0 条日志',
        deletedCount: 0,
        note: unavailableNote,
      });
      return;
    }

    const body = (await readJsonBody(request) ?? {}) as {
      days?: number;
      maxRecords?: number;
    };
    const { days, maxRecords } = body;
    let deletedCount = 0;

    if (days && typeof days === 'number' && days > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const deleted = await LogModel.delete({ timestamp: { $lt: cutoffDate } });
      deletedCount += typeof deleted === 'number' ? deleted : (deleted as unknown[] | undefined)?.length || 0;
    }

    if (maxRecords && typeof maxRecords === 'number' && maxRecords > 0) {
      const totalLogs = await LogModel.select();
      if (totalLogs.length > maxRecords) {
        const excessCount = totalLogs.length - maxRecords;
        const oldestLogs = await LogModel.select('id', 'timestamp')
          .orderBy('timestamp', 'ASC')
          .limit(excessCount);
        const idsToDelete = oldestLogs.map((log) => log.id);

        if (idsToDelete.length > 0) {
          const deleted = await LogModel.delete({ id: { $in: idsToDelete } });
          deletedCount += typeof deleted === 'number' ? deleted : (deleted as unknown[] | undefined)?.length || 0;
        }
      }
    }

    writeJson(response, 200, {
      success: true,
      message: `已清理 ${deletedCount} 条日志`,
      deletedCount,
    });
  }, { summary: 'Cleanup old system logs', tags: ['console', 'logs'] });
}

// ---------------------------------------------------------------------------
// marketplace（legacy marketplace-rest-api.ts；plugins.json + npmmirror）
// ---------------------------------------------------------------------------

function registerMarketplaceRoutes(
  route: HttpHost['route'],
  base: string,
  ctx: ConsoleRestCtx,
  fetchFn: typeof fetch,
  pluginRegistryUrl: string,
  npmRegistryUrl: string,
): void {
  const fetchPluginRegistry = async (): Promise<unknown[]> => {
    if (pluginsCache && Date.now() - pluginsCache.ts < PLUGINS_CACHE_TTL) {
      return pluginsCache.data;
    }
    const resp = await fetchFn(pluginRegistryUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`plugins.json fetch failed: ${resp.status}`);
    const json = (await resp.json()) as { plugins?: unknown[] };
    const list = json.plugins || [];
    pluginsCache = { data: list, ts: Date.now() };
    return list;
  };

  route('GET', '/pub/marketplace/search', async (_request, response, url) => {
    const q = url.searchParams.get('q') ?? url.searchParams.get('keyword') ?? '';
    const pageNum = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get('size') ?? url.searchParams.get('limit') ?? '20', 10) || 20),
    );
    const category = url.searchParams.get('category') ?? undefined;
    const official = url.searchParams.get('official') ?? undefined;
    const searchKeyword = q.trim().toLowerCase();

    try {
      const allPlugins = (await fetchPluginRegistry()) as Array<Record<string, unknown>>;
      let plugins = allPlugins.map((p) => ({
        name: p.name,
        displayName: p.displayName || '',
        version: p.version || '',
        description: p.description || '',
        author: p.author || '',
        isOfficial: !!p.isOfficial,
        official: !!p.isOfficial,
        category: p.category || 'util',
        keywords: (p.tags as string[]) || [],
        npm: p.npm || `https://www.npmjs.com/package/${p.name}`,
        date: p.lastUpdate || '',
        downloads: p.downloads || { weekly: 0, monthly: 0 },
        readme: p.readme || '',
        license: p.license || '',
      }));

      if (searchKeyword) {
        plugins = plugins.filter((p) => {
          const haystack = [p.name, p.displayName, p.description, ...(p.keywords || [])]
            .join(' ')
            .toLowerCase();
          return haystack.includes(searchKeyword);
        });
      }
      if (category) plugins = plugins.filter((p) => p.category === category);
      if (official === 'true') plugins = plugins.filter((p) => p.official);
      if (official === 'false') plugins = plugins.filter((p) => !p.official);

      const total = plugins.length;
      const start = (pageNum - 1) * pageSize;
      const items = plugins.slice(start, start + pageSize);
      writeJson(response, 200, {
        success: true,
        data: items,
        total,
        page: pageNum,
        size: pageSize,
      });
    } catch (err) {
      writeJson(response, 502, {
        success: false,
        error: err instanceof Error ? err.message : 'Search failed',
      });
    }
  }, { summary: 'Search plugin marketplace', tags: ['pub', 'marketplace'] });

  route('GET', '/pub/marketplace/detail/*', async (_request, response, url) => {
    const prefix = '/pub/marketplace/detail/';
    const rawName = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/\/+$/u, '')
      : '';
    if (!rawName) {
      writeJson(response, 404, { success: false, error: 'Package name is required' });
      return;
    }
    const pkgName = decodePathParam(rawName);
    try {
      let cachedDownloads = { weekly: 0, monthly: 0 };
      try {
        const registry = (await fetchPluginRegistry()) as Array<{
          name?: string;
          downloads?: unknown;
        }>;
        const cached = registry.find((p) => p.name === pkgName);
        if (cached?.downloads && typeof cached.downloads === 'object') {
          cachedDownloads = cached.downloads as { weekly: number; monthly: number };
        }
      } catch {
        /* ignore cache miss */
      }

      const metaResp = await fetchFn(
        `${npmRegistryUrl}/${encodeURIComponent(pkgName)}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (!metaResp.ok) throw new Error(`Package not found: ${metaResp.status}`);
      const meta = (await metaResp.json()) as Record<string, unknown>;
      const latest = (meta['dist-tags'] as Record<string, string> | undefined)?.latest;
      const versions = meta.versions as Record<string, Record<string, unknown>> | undefined;
      const latestInfo = latest && versions ? versions[latest] : undefined;
      const time = meta.time as Record<string, string> | undefined;
      writeJson(response, 200, {
        success: true,
        data: {
          name: meta.name,
          version: latest,
          description: meta.description || '',
          readme: meta.readme || '',
          license: meta.license || latestInfo?.license || '',
          homepage: meta.homepage || latestInfo?.homepage || '',
          repository:
            (meta.repository as { url?: string } | undefined)?.url ||
            (latestInfo?.repository as { url?: string } | undefined)?.url ||
            '',
          author:
            typeof meta.author === 'string'
              ? meta.author
              : (meta.author as { name?: string } | undefined)?.name || '',
          keywords: (latestInfo?.keywords as string[]) || [],
          engines: latestInfo?.engines || {},
          peerDependencies: latestInfo?.peerDependencies || {},
          downloads: cachedDownloads,
          versions: Object.keys(versions || {}),
          lastPublish: (latest && time?.[latest]) || '',
        },
      });
    } catch (err) {
      writeJson(response, 502, {
        success: false,
        error: err instanceof Error ? err.message : 'Detail fetch failed',
      });
    }
  }, { summary: 'Plugin marketplace detail', tags: ['pub', 'marketplace'] });

  route('GET', `${base}/marketplace/updates`, async (_request, response) => {
    try {
      const installed = await listInstalledPluginPackages(ctx.projectRoot);
      if (!installed.length) {
        writeJson(response, 200, { success: true, data: [] });
        return;
      }
      const updates = await Promise.all(
        installed.map(async ({ name, current }) => {
          try {
            const resp = await fetchFn(
              `${npmRegistryUrl}/${encodeURIComponent(name)}/latest`,
              { signal: AbortSignal.timeout(15_000) },
            );
            if (!resp.ok) return null;
            const pkg = (await resp.json()) as { version?: string; description?: string };
            return {
              name,
              latest: pkg.version,
              description: pkg.description || '',
              // 本地已装版本对照：读不到 package.json 时省略该字段。
              ...(current ? { current } : {}),
            };
          } catch {
            return null;
          }
        }),
      );
      writeJson(response, 200, { success: true, data: updates.filter(Boolean) });
    } catch (err) {
      writeJson(response, 500, {
        success: false,
        error: err instanceof Error ? err.message : 'Update check failed',
      });
    }
  }, { summary: 'Check installed plugin updates', tags: ['console', 'marketplace'] });
}

/**
 * 本地已装插件包：projectRoot/package.json 的 `zhin.plugins`（{package, instanceKey}[]），
 * 按包名去重；版本读 `node_modules/<pkg>/package.json`（读不到则省略）。
 */
async function listInstalledPluginPackages(
  projectRoot: string,
): Promise<Array<{ name: string; current?: string }>> {
  const names = new Set<string>();
  try {
    const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
      readonly zhin?: { readonly plugins?: unknown };
    };
    const list = pkg.zhin?.plugins;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === 'string' && item) {
          names.add(item);
        } else if (item && typeof item === 'object') {
          const entry = (item as { package?: unknown }).package;
          if (typeof entry === 'string' && entry) names.add(entry);
        }
      }
    }
  } catch {
    // 无 package.json 或格式不符 — 返回空列表
  }
  return Promise.all([...names].map(async (name) => {
    try {
      const installed = JSON.parse(
        await readFile(join(projectRoot, 'node_modules', name, 'package.json'), 'utf8'),
      ) as { version?: unknown };
      const current = typeof installed.version === 'string' ? installed.version : undefined;
      return current ? { name, current } : { name };
    } catch {
      return { name };
    }
  }));
}

// ---------------------------------------------------------------------------
// introspection（legacy introspection-rest-api.ts；分页形状对齐 IntrospectionJsonResponse）
// ---------------------------------------------------------------------------

function registerIntrospectionRoutes(
  route: HttpHost['route'],
  base: string,
  ctx: ConsoleRestCtx,
): void {
  const collectors: Array<{
    kind: IntrospectionKind;
    collect: () => { rows: readonly unknown[]; note?: string };
    fields: Array<(item: unknown) => string | undefined>;
  }> = [
    {
      kind: 'commands',
      collect: () => ({ rows: agentIntrospection(ctx)?.commands?.() ?? [] }),
      fields: [
        (c) => stringProp(c, 'pattern'),
        (c) => stringProp(c, 'desc'),
        (c) => stringProp(c, 'plugin'),
      ],
    },
    {
      kind: 'endpoints',
      collect: () => ({
        rows: (ctx.getEndpoints?.() ?? []).map((endpoint) => ({
          adapter: endpoint.adapter,
          name: endpoint.name,
          online: endpoint.connected,
          status: endpoint.status,
        })),
      }),
      fields: [(b) => stringProp(b, 'adapter'), (b) => stringProp(b, 'name')],
    },
    {
      kind: 'bindings',
      collect: () => ({ rows: agentIntrospection(ctx)?.bindings?.() ?? [] }),
      fields: [
        (a) => stringProp(a, 'name'),
        (a) => stringProp(a, 'provider'),
        (a) => stringProp(a, 'model'),
      ],
    },
    {
      kind: 'tools',
      collect: () => ({ rows: agentIntrospection(ctx)?.tools?.() ?? [] }),
      fields: [
        (t) => stringProp(t, 'name'),
        (t) => stringProp(t, 'source'),
        (t) => stringProp(t, 'description'),
      ],
    },
    {
      kind: 'mcp',
      collect: () => {
        const result = agentIntrospection(ctx)?.mcp?.();
        if (result == null) return { rows: [] as readonly unknown[] };
        // readonly 数组不能用 Array.isArray 收窄，按对象形状判断
        if (typeof result === 'object' && 'rows' in result) {
          return { rows: result.rows, note: result.note };
        }
        return { rows: result as readonly unknown[] };
      },
      fields: [(s) => stringProp(s, 'name')],
    },
  ];

  for (const { kind, collect, fields } of collectors) {
    route('GET', `${base}/introspection/${kind}`, async (_request, response, url) => {
      try {
        const { rows, note } = collect();
        const query = url.searchParams;
        const filter = query.get('filter')?.trim() || undefined;
        const filtered = filterByFields([...rows], filter, fields);
        const slice = paginateItems(
          filtered,
          parsePositiveInt(query.get('page'), 1),
          parsePositiveInt(query.get('pageSize'), INTROSPECTION_PAGE_SIZES[kind]),
        );
        const missing = kind === 'endpoints'
          ? !ctx.getEndpoints
          : !agentIntrospection(ctx);
        const degradedNote = note ?? (missing
          ? kind === 'endpoints'
            ? 'Endpoints 数据源未接线（ctx.getEndpoints 缺失）'
            : 'Agent runtime 未装配（basic/cli 未接线 getAgentRuntime）'
          : undefined);
        writeJson(response, 200, {
          success: true,
          data: { ...slice, filter, note: degradedNote },
        });
      } catch (err) {
        writeJson(response, 503, {
          success: false,
          data: { items: [], page: 1, pageSize: 0, total: 0, totalPages: 0 },
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, { summary: `Introspection: ${kind}`, tags: ['console', 'introspection'] });
  }
}

function agentIntrospection(ctx: ConsoleRestCtx): ConsoleAgentIntrospection | undefined {
  const runtime = ctx.getAgentRuntime?.() as ConsoleAgentRuntime | null | undefined;
  return runtime && typeof runtime === 'object' ? runtime.introspection : undefined;
}

// ---------------------------------------------------------------------------
// agent sessions（legacy agent-sessions-rest-api.ts；ADR 0010 D3）
// ---------------------------------------------------------------------------

function registerAgentSessionRoutes(
  route: HttpHost['route'],
  base: string,
  ctx: ConsoleRestCtx,
): void {
  const prefix = `${base}/agent/sessions/`;
  const getSessionTree = (): ConsoleAgentSessionTree | null => {
    const runtime = ctx.getAgentRuntime?.() as ConsoleAgentRuntime | null | undefined;
    const tree = runtime && typeof runtime === 'object' ? runtime.sessionTree : undefined;
    if (!tree) return null;
    if (typeof tree.resolveActiveSessionId !== 'function') return null;
    return tree;
  };
  const unavailable = (response: ServerResponse) => {
    writeJson(response, 503, {
      success: false,
      error: 'Agent session tree runtime 未就绪（新 Runtime 需经 getAgentRuntime 装配 sessionTree）',
    });
  };

  // HttpHost 无 `:param` 路由，用前缀路由匹配 `<sessionKey>/tree|leaf`。
  route('GET', `${base}/agent/sessions/*`, async (_request, response, url) => {
    const parsed = parseSessionAction(url.pathname, prefix, 'tree');
    if (!parsed) {
      writeJson(response, 404, { success: false, error: 'Not found' });
      return;
    }
    const runtime = getSessionTree();
    if (!runtime) {
      unavailable(response);
      return;
    }

    const sessionId = await runtime.resolveActiveSessionId(parsed.sessionKey);
    if (!sessionId) {
      writeJson(response, 404, {
        success: false,
        error: `未找到活跃会话：${parsed.sessionKey}`,
      });
      return;
    }

    const session = await runtime.agentSessionStore.getBySessionId(sessionId);
    const points = await runtime.listBranchPoints(sessionId);
    writeJson(response, 200, {
      success: true,
      data: {
        sessionKey: parsed.sessionKey,
        sessionId,
        activeLeafMessageId: session?.active_leaf_message_id ?? null,
        points,
      },
    });
  }, { summary: 'Get agent session tree', tags: ['console', 'agent'] });

  route('POST', `${base}/agent/sessions/*`, async (request, response, url, authScope) => {
    const parsed = parseSessionAction(url.pathname, prefix, 'leaf');
    if (!parsed) {
      writeJson(response, 404, { success: false, error: 'Not found' });
      return;
    }
    if (!requireWriteScope(response, ctx, authScope)) return;
    const runtime = getSessionTree();
    if (!runtime) {
      unavailable(response);
      return;
    }

    const sessionId = await runtime.resolveActiveSessionId(parsed.sessionKey);
    if (!sessionId) {
      writeJson(response, 404, {
        success: false,
        error: `未找到活跃会话：${parsed.sessionKey}`,
      });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = (await readJsonBody(request) ?? {}) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof HttpBodyError) {
        writeJson(response, error.statusCode, { success: false, error: error.message });
        return;
      }
      throw error;
    }
    const messageIdRaw = body.messageId;
    const indexRaw = body.index;

    let messageId: number | undefined;
    if (messageIdRaw != null && messageIdRaw !== '') {
      const n = Number(messageIdRaw);
      if (!Number.isFinite(n) || n < 1) {
        writeJson(response, 400, { success: false, error: 'messageId 须为正整数' });
        return;
      }
      messageId = n;
    } else if (indexRaw != null && indexRaw !== '') {
      const index = Number(indexRaw);
      if (!Number.isFinite(index) || index < 1) {
        writeJson(response, 400, { success: false, error: 'index 须为正整数' });
        return;
      }
      const result = await runtime.jumpToBranchIndex(sessionId, index);
      const session = await runtime.agentSessionStore.getBySessionId(sessionId);
      writeJson(response, result.ok ? 200 : 400, {
        success: result.ok,
        message: result.message,
        data: {
          sessionKey: parsed.sessionKey,
          sessionId,
          activeLeafMessageId: session?.active_leaf_message_id ?? null,
        },
      });
      return;
    } else {
      writeJson(response, 400, { success: false, error: '需要 messageId 或 index 之一' });
      return;
    }

    const ok = await runtime.switchActiveLeaf(sessionId, messageId);
    const session = await runtime.agentSessionStore.getBySessionId(sessionId);
    writeJson(response, ok ? 200 : 400, {
      success: ok,
      message: ok ? `已切换 active leaf 至消息 #${messageId}` : '切换失败',
      data: {
        sessionKey: parsed.sessionKey,
        sessionId,
        activeLeafMessageId: session?.active_leaf_message_id ?? null,
      },
    });
  }, { summary: 'Switch agent session active leaf', tags: ['console', 'agent'] });
}

function parseSessionAction(
  pathname: string,
  prefix: string,
  action: 'tree' | 'leaf',
): { sessionKey: string } | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/+$/u, '');
  const suffix = `/${action}`;
  if (!rest.endsWith(suffix)) return null;
  const rawKey = rest.slice(0, -suffix.length);
  if (!rawKey) return null;
  return { sessionKey: decodePathParam(rawKey) };
}

// ---------------------------------------------------------------------------
// 内部分页 / 过滤（语义对齐 agent 包 introspection-pagination.ts）
// ---------------------------------------------------------------------------

function paginateItems<T>(
  all: T[],
  page: number,
  pageSize: number,
): { items: T[]; page: number; pageSize: number; total: number; totalPages: number } {
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

function filterByFields<T>(
  items: T[],
  filter: string | undefined,
  fields: Array<(item: T) => string | undefined>,
): T[] {
  if (!filter?.trim()) return items;
  return items.filter((item) => {
    const blob = fields
      .map((f) => f(item) ?? '')
      .join(' ')
      .toLowerCase();
    return blob.includes(filter.trim().toLowerCase());
  });
}

function stringProp(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const prop = (value as Record<string, unknown>)[key];
  return typeof prop === 'string' ? prop : undefined;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw && /^\d+$/u.test(raw)) return Math.max(1, parseInt(raw, 10));
  return fallback;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 写操作门禁：demo 部署（ctx.fullScope=false）或 demo token 均 403。 */
function requireWriteScope(
  response: ServerResponse,
  ctx: ConsoleRestCtx,
  authScope: AuthScope,
): boolean {
  if (ctx.fullScope && authScope === 'full') return true;
  writeJson(response, 403, {
    success: false,
    error: 'Demo scope: 只读访问，写操作被拒绝',
  });
  return false;
}

function decodePathParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeBase(value: string): string {
  if (!value.startsWith('/')) return `/${value}`;
  return value.replace(/\/+$/u, '') || '/api';
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}
