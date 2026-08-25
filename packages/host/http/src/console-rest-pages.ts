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
  readonly acquireAgentRuntime?: () => {
    readonly value: ConsoleAgentRuntime;
    release(): void;
  } | null;
  /** Database host（logs 页数据源：SystemLog 模型）。 */
  readonly databaseHost?: {
    readonly dialect: string;
    readonly started: boolean;
    readonly models: { get(name: string): unknown };
  };
  /** Distinguishes a real IM conversation with no Agent turn from a typo key. */
  readonly isKnownConversationSession?: (
    sessionKey: string,
  ) => boolean | undefined | Promise<boolean | undefined>;
}

/** 内省数据门面 — 由 basic/cli 用 agent 包 collectIntrospection* 装配。 */
export interface ConsoleAgentIntrospection {
  commands?(): readonly unknown[];
  middlewares?(): readonly unknown[];
  components?(): readonly unknown[];
  bindings?(): readonly unknown[];
  tools?(): readonly unknown[];
  promptSections?(): readonly unknown[];
  mcp?(): { rows: readonly unknown[]; note?: string } | readonly unknown[];
  renderComponent?(input: Readonly<{
    requester: string;
    name: string;
    props: unknown;
    signal: AbortSignal;
  }>): Promise<unknown>;
}

/** Session tree 门面 — 形状对齐 agent 包 SessionTreeRuntimeHandle。 */
export interface ConsoleAgentSessionTree {
  resolveActiveSessionId(sessionKey: string): Promise<string | null>;
  getActiveLeafMessageId(sessionId: string): Promise<number | null>;
  listBranchPoints(sessionId: string): Promise<readonly unknown[]>;
  switchActiveLeaf(sessionId: string, messageId: number): Promise<boolean>;
  jumpToBranchIndex(
    sessionId: string,
    index: number,
  ): Promise<{ ok: boolean; message: string }>;
}

/** `ctx.acquireAgentRuntime()` 返回值的最小结构约定（全部可选，逐项降级）。 */
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
  /** Component preview deadline; default 5 seconds. */
  readonly componentPreviewTimeoutMs?: number;
  /** Maximum serialized Component preview; default 256 KiB. */
  readonly componentPreviewMaxBytes?: number;
  /** Maximum in-flight Component previews per Console route set; default 2. */
  readonly componentPreviewMaxConcurrent?: number;
}

type LogModelLike = {
  select(...fields: string[]): LogSelectionLike;
  delete(where: Record<string, unknown>): Promise<unknown>;
  /** DB 侧 count 聚合（可选；缺失时降级为 select('id') 计数）。 */
  count?(where?: Record<string, unknown>): Promise<number>;
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
  middlewares: 30,
  components: 30,
  tools: 15,
  'prompt-sections': 20,
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
  const npmRegistryUrl = trimTrailingSlashes(
    options.npmRegistryUrl ?? 'https://registry.npmmirror.com',
  );
  const disposers: Array<() => void> = [];
  const route: typeof host.route = (method, path, handler, meta) => {
    const dispose = host.route(method, path, handler, meta);
    disposers.push(dispose);
    return dispose;
  };

  registerLogsRoutes(route, base, ctx);
  registerMarketplaceRoutes(route, base, ctx, fetchFn, pluginRegistryUrl, npmRegistryUrl);
  registerIntrospectionRoutes(route, base, ctx, options);
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

    // 计数走 DB 侧聚合（count）；模型未实现 count 时降级为 select('id') 只取主键列
    const countRows = async (where?: Record<string, unknown>): Promise<number> => {
      if (typeof LogModel.count === 'function') return LogModel.count(where);
      const selection = LogModel.select('id');
      const rows = await (where ? selection.where(where) : selection);
      return rows.length;
    };

    const total = await countRows();
    const levels = ['info', 'warn', 'error'];
    const levelCounts: Record<string, number> = {};

    for (const level of levels) {
      levelCounts[level] = await countRows({ level });
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
      data: { total, byLevel: levelCounts, oldestTimestamp },
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
  options: ConsoleRestPagesOptions,
): void {
  const collectors: Array<{
    kind: IntrospectionKind;
    collect: (introspection: ConsoleAgentIntrospection | undefined) => { rows: readonly unknown[]; note?: string };
    fields: Array<(item: unknown) => string | undefined>;
  }> = [
    {
      kind: 'commands',
      collect: (value) => ({ rows: value?.commands?.() ?? [] }),
      fields: [
        (c) => stringProp(c, 'pattern'),
        (c) => stringProp(c, 'desc'),
        (c) => stringProp(c, 'plugin'),
      ],
    },
    {
      kind: 'middlewares',
      collect: (value) => ({ rows: value?.middlewares?.() ?? [] }),
      fields: [
        (m) => stringProp(m, 'name'),
        (m) => stringProp(m, 'owner'),
        (m) => stringProp(m, 'phase'),
        (m) => stringProp(m, 'target'),
        (m) => stringProp(m, 'source'),
      ],
    },
    {
      kind: 'components',
      collect: (value) => ({ rows: value?.components?.() ?? [] }),
      fields: [
        (c) => stringProp(c, 'name'),
        (c) => stringProp(c, 'owner'),
        (c) => stringProp(c, 'source'),
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
      collect: (value) => ({ rows: value?.bindings?.() ?? [] }),
      fields: [
        (a) => stringProp(a, 'name'),
        (a) => stringProp(a, 'provider'),
        (a) => stringProp(a, 'model'),
      ],
    },
    {
      kind: 'tools',
      collect: (value) => ({ rows: value?.tools?.() ?? [] }),
      fields: [
        (t) => stringProp(t, 'name'),
        (t) => stringProp(t, 'source'),
        (t) => stringProp(t, 'description'),
      ],
    },
    {
      kind: 'prompt-sections',
      collect: (value) => ({ rows: value?.promptSections?.() ?? [] }),
      fields: [
        (section) => stringProp(section, 'name'),
        (section) => stringProp(section, 'qualifiedName'),
        (section) => stringProp(section, 'title'),
        (section) => stringProp(section, 'owner'),
        (section) => stringProp(section, 'layer'),
        (section) => stringProp(section, 'retention'),
        (section) => stringProp(section, 'source'),
      ],
    },
    {
      kind: 'mcp',
      collect: (value) => {
        const result = value?.mcp?.();
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
      const lease = kind === 'endpoints' ? null : ctx.acquireAgentRuntime?.() ?? null;
      try {
        const introspection = lease?.value.introspection;
        const { rows, note } = collect(introspection);
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
          : !introspection;
        const degradedNote = note ?? (missing
          ? kind === 'endpoints'
            ? 'Endpoints 数据源未接线（ctx.getEndpoints 缺失）'
            : 'Agent runtime 未装配（basic/cli 未接线 acquireAgentRuntime）'
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
      } finally {
        lease?.release();
      }
    }, { summary: `Introspection: ${kind}`, tags: ['console', 'introspection'] });
  }

  let activeComponentPreviews = 0;
  route('POST', `${base}/introspection/components/render`, async (request, response, _url, authScope) => {
    if (!requireWriteScope(response, ctx, authScope)) return;
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    const requester = typeof body.requester === 'string' ? body.requester.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!requester || !name || requester.length > 256 || name.length > 160) {
      writeJson(response, 400, { success: false, error: '请提供有效的 requester 与 component name' });
      return;
    }
    const maxConcurrent = clampPositiveInt(options.componentPreviewMaxConcurrent, 2, 8);
    if (activeComponentPreviews >= maxConcurrent) {
      writeJson(response, 503, { success: false, error: 'Component preview 正忙，请稍后重试' });
      return;
    }
    const lease = ctx.acquireAgentRuntime?.();
    const render = lease?.value.introspection?.renderComponent;
    if (!lease || !render) {
      lease?.release();
      writeJson(response, 503, { success: false, error: 'Component Runtime 未就绪' });
      return;
    }
    const controller = new AbortController();
    const timeoutMs = clampPositiveInt(options.componentPreviewTimeoutMs, 5_000, 30_000);
    const timeout = setTimeout(() => controller.abort(
      new ComponentPreviewTimeoutError(`Component preview 超过 ${timeoutMs}ms`),
    ), timeoutMs);
    activeComponentPreviews += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeComponentPreviews -= 1;
      lease.release();
    };
    const renderPromise = Promise.resolve().then(() =>
      render({ requester, name, props: body.props ?? {}, signal: controller.signal }));
    // A timed-out implementation may ignore AbortSignal. Keep its generation
    // lease until the real operation settles; the bounded concurrency gate
    // prevents non-cooperative previews from pinning unbounded generations.
    void renderPromise.then(release, release);
    try {
      const output = await raceWithAbort(
        renderPromise,
        controller.signal,
      );
      assertPreviewOutput(output, options.componentPreviewMaxBytes ?? 256 * 1024);
      writeJson(response, 200, { success: true, data: { requester, name, output } });
    } catch (error) {
      const status = error instanceof ComponentPreviewTimeoutError
        ? 408
        : error instanceof ComponentPreviewLimitError ? 413 : 422;
      writeJson(response, status, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
      if (!controller.signal.aborted) controller.abort();
    }
  }, { summary: 'Render a Component preview', tags: ['console', 'introspection', 'component'] });
}

class ComponentPreviewTimeoutError extends Error {
  override readonly name = 'ComponentPreviewTimeoutError';
}

class ComponentPreviewLimitError extends Error {
  override readonly name = 'ComponentPreviewLimitError';
}

function clampPositiveInt(value: number | undefined, fallback: number, ceiling: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), ceiling);
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Component preview aborted', 'AbortError');
}

function assertPreviewOutput(output: unknown, maxBytes: number): void {
  const byteLimit = clampPositiveInt(maxBytes, 256 * 1024, 1024 * 1024);
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 10_000) throw new ComponentPreviewLimitError('Component preview 节点数超过 10000');
    if (depth > 24) throw new ComponentPreviewLimitError('Component preview 嵌套深度超过 24');
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) throw new ComponentPreviewLimitError('Component preview 不能包含循环引用');
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item, depth + 1);
    }
  };
  visit(output, 0);
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch (error) {
    throw new ComponentPreviewLimitError(
      `Component preview 无法序列化: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (Buffer.byteLength(serialized ?? '') > byteLimit) {
    throw new ComponentPreviewLimitError(`Component preview 超过 ${byteLimit} bytes`);
  }
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
  const acquireSessionTree = (): {
    readonly tree: ConsoleAgentSessionTree;
    release(): void;
  } | null => {
    const lease = ctx.acquireAgentRuntime?.();
    const tree = lease?.value.sessionTree;
    if (!lease || !tree || typeof tree.resolveActiveSessionId !== 'function') {
      lease?.release();
      return null;
    }
    return { tree, release: () => lease.release() };
  };
  const unavailable = (response: ServerResponse) => {
    writeJson(response, 503, {
      success: false,
      error: 'Agent session tree runtime 未就绪（新 Runtime 需经 acquireAgentRuntime 装配 sessionTree）',
    });
  };

  // HttpHost 无 `:param` 路由，用前缀路由匹配 `<sessionKey>/tree|leaf`。
  route('GET', `${base}/agent/sessions/*`, async (_request, response, url) => {
    const parsed = parseSessionAction(url.pathname, prefix, 'tree');
    if (!parsed) {
      writeJson(response, 404, { success: false, error: 'Not found' });
      return;
    }
    const lease = acquireSessionTree();
    if (!lease) {
      unavailable(response);
      return;
    }
    const runtime = lease.tree;
    try {
      const sessionId = await runtime.resolveActiveSessionId(parsed.sessionKey);
      if (!sessionId) {
        if (!isRuntimeImSessionKey(parsed.sessionKey)) {
          writeJson(response, 404, {
            success: false,
            error: `未找到会话：${parsed.sessionKey}`,
          });
          return;
        }
        const knownConversation = await ctx.isKnownConversationSession?.(parsed.sessionKey);
        if (knownConversation === false) {
          writeJson(response, 404, {
            success: false,
            error: `未找到会话：${parsed.sessionKey}`,
          });
          return;
        }
        // 渠道会话与 Agent 会话的生命周期不同：用户可以先在 Console
        // 选中一个真实渠道会话，而该会话尚未触发过 Agent。树查询是只读操作，
        // 因而将这种正常状态返回为可渲染空态，而不是误报资源不存在。
        writeJson(response, 200, {
          success: true,
          data: {
            state: 'not_started',
            sessionKey: parsed.sessionKey,
            sessionId: null,
            activeLeafMessageId: null,
            points: [],
          },
        });
        return;
      }

      const activeLeafMessageId = await runtime.getActiveLeafMessageId(sessionId);
      const points = await runtime.listBranchPoints(sessionId);
      writeJson(response, 200, {
        success: true,
        data: {
          state: 'active',
          sessionKey: parsed.sessionKey,
          sessionId,
          activeLeafMessageId,
          points,
        },
      });
    } finally {
      lease.release();
    }
  }, { summary: 'Get agent session tree', tags: ['console', 'agent'] });

  route('POST', `${base}/agent/sessions/*`, async (request, response, url, authScope) => {
    const parsed = parseSessionAction(url.pathname, prefix, 'leaf');
    if (!parsed) {
      writeJson(response, 404, { success: false, error: 'Not found' });
      return;
    }
    if (!requireWriteScope(response, ctx, authScope)) return;
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
    let branchIndex: number | undefined;
    if (messageIdRaw != null && messageIdRaw !== '') {
      const value = Number(messageIdRaw);
      if (!Number.isFinite(value) || value < 1) {
        writeJson(response, 400, { success: false, error: 'messageId 须为正整数' });
        return;
      }
      messageId = value;
    } else if (indexRaw != null && indexRaw !== '') {
      const value = Number(indexRaw);
      if (!Number.isFinite(value) || value < 1) {
        writeJson(response, 400, { success: false, error: 'index 须为正整数' });
        return;
      }
      branchIndex = value;
    } else {
      writeJson(response, 400, { success: false, error: '需要 messageId 或 index 之一' });
      return;
    }

    const lease = acquireSessionTree();
    if (!lease) {
      unavailable(response);
      return;
    }
    const runtime = lease.tree;
    try {
      const sessionId = await runtime.resolveActiveSessionId(parsed.sessionKey);
      if (!sessionId) {
        writeJson(response, 404, {
          success: false,
          error: `未找到活跃会话：${parsed.sessionKey}`,
        });
        return;
      }

      if (branchIndex !== undefined) {
        const result = await runtime.jumpToBranchIndex(sessionId, branchIndex);
        const activeLeafMessageId = await runtime.getActiveLeafMessageId(sessionId);
        writeJson(response, result.ok ? 200 : 400, {
          success: result.ok,
          message: result.message,
          data: {
            sessionKey: parsed.sessionKey,
            sessionId,
            activeLeafMessageId,
          },
        });
        return;
      }

      const ok = await runtime.switchActiveLeaf(sessionId, messageId!);
      const activeLeafMessageId = await runtime.getActiveLeafMessageId(sessionId);
      writeJson(response, ok ? 200 : 400, {
        success: ok,
        message: ok ? `已切换 active leaf 至消息 #${messageId}` : '切换失败',
        data: {
          sessionKey: parsed.sessionKey,
          sessionId,
          activeLeafMessageId,
        },
      });
    } finally {
      lease.release();
    }
  }, { summary: 'Switch agent session active leaf', tags: ['console', 'agent'] });
}

/** Runtime IM session keys are `<platform>:<endpoint>:<scope>:<sceneId>`. */
function isRuntimeImSessionKey(value: string): boolean {
  const first = value.indexOf(':');
  const second = value.indexOf(':', first + 1);
  const third = value.indexOf(':', second + 1);
  return first > 0
    && second > first + 1
    && third > second + 1
    && third < value.length - 1;
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

function trimTrailingSlashes(s: string): string {
  let i = s.length;
  while (i > 0 && s[i - 1] === '/') i--;
  return s.slice(0, i);
}

function normalizeBase(value: string): string {
  if (!value.startsWith('/')) return `/${value}`;
  return trimTrailingSlashes(value) || '/api';
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}
