/**
 * Console REST pages — logs / marketplace / introspection / agent sessions。
 *
 * 统一提供日志、市场、Runtime snapshot 内省和 Agent session tree 页面。
 *
 * 数据源不可用时降级：读操作返回空数组 + `note` 说明，session tree 返回 503；
 * 写操作要求 `ctx.fullScope`，否则 403。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HttpHost } from './http-host.js';
import { readJsonBody } from './json-body.js';
import { jsonResponse } from '@zhin.js/host-http-contract';
import {
  MarketplaceDetailCache,
  MarketplaceRegistry,
  isValidNpmPackageName,
} from './marketplace-registry.js';
import type { ConsoleMessageEventData } from '@zhin.js/console-protocol';
import {
  informativeKeywords,
  isLocale,
  normalizePluginCategory,
  packageAuthorName,
  pickLocalizedText,
  readPluginMarketplaceMetadata,
  type PluginLocalizedText,
} from '@zhin.js/plugin-runtime';
import {
  clampPositiveInt,
  decodePathParam,
  logInternalError,
  normalizeBase,
  parsePositiveInt,
  registerAgentSessionRoutes,
  registerIntrospectionRoutes,
  requireWriteScope,
  trimTrailingSlashes,
} from './console-rest-pages-helpers.js';

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

/** 内省数据门面 — 由 composition root 从当前 Runtime snapshot 装配。 */
export interface ConsoleAgentIntrospection {
  commands?(): readonly unknown[];
  middlewares?(): readonly unknown[];
  components?(): readonly unknown[];
  /** Agent bindings with the provider / model they actually run on (may read the provider graph). */
  bindings?(): readonly unknown[] | Promise<readonly unknown[]>;
  /** Recent Agent turns from the trace archive, newest first (#1250). */
  recentTurns?(): readonly unknown[] | Promise<readonly unknown[]>;
  tools?(): readonly unknown[];
  promptSections?(): readonly unknown[];
  mcp?(): { rows: readonly unknown[]; note?: string } | readonly unknown[];
  renderComponent?(input: Readonly<{
    requester: string;
    name: string;
    props: unknown;
    signal: AbortSignal;
  }>): Promise<unknown>;
  previewComponentDelivery?(input: Readonly<{
    requester: string; name: string; props: unknown; target: unknown; signal: AbortSignal;
  }>): Promise<Readonly<{ output: unknown; rendering: NonNullable<ConsoleMessageEventData['rendering']>; generation: number; note: string }>>;
}

/** Session tree 门面 — 形状对齐 agent 包 SessionTreeRuntimeHandle。 */
export interface ConsoleAgentSessionTree {
  resolveActiveSessionId(sessionKey: string): Promise<string | null>;
  getActiveLeafMessageId(sessionId: string): Promise<number | null>;
  listBranchPoints(sessionId: string): Promise<readonly unknown[]>;
  readBranchMessage?(sessionId: string, messageId: number): Promise<string | null>;
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
  offset?(count: number): LogSelectionLike;
};

type LogRow = {
  id?: unknown;
  level?: string;
  name?: string;
  message?: string;
  source?: string;
  timestamp?: string | Date;
};

const PLUGINS_CACHE_TTL = 5 * 60 * 1000;
const PACKAGE_DETAIL_CACHE_TTL = 5 * 60 * 1000;
const PACKAGE_DETAIL_CACHE_MAX_ENTRIES = 64;

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

  route('GET', `${base}/logs`, async (_request, { url }) => {
    const pageSize = clampPositiveInt(parsePositiveInt(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'), 100), 100, 1000);
    const requestedPage = clampPositiveInt(parsePositiveInt(url.searchParams.get('page'), 1), 1, Number.MAX_SAFE_INTEGER);
    const level = url.searchParams.get('level');
    const source = url.searchParams.get('source')?.trim();
    const query = url.searchParams.get('q')?.trim();
    const baseWhere: Record<string, unknown> = {
      ...(level && level !== 'all' ? { level } : {}),
    };
    const where = { ...baseWhere, ...(source ? { source } : {}) };
    const LogModel = getModel();
    if (!LogModel) {
      return jsonResponse(200, { success: true, data: [], total: 0, page: 1, pageSize, totalPages: 1, sources: [], note: unavailableNote });
    }
    // Database $like has no portable ESCAPE contract. Keep q literal (including
    // %/_ and Unicode) and filter actual retained rows on the Host, not wildcard SQL.
    const matchesQuery = (row: LogRow): boolean => !query || ['message', 'name', 'source']
      .some(field => String(row[field as keyof LogRow] ?? '').toLowerCase().includes(query.toLowerCase()));
    const selection = LogModel.select().where(where).orderBy('timestamp', 'DESC').orderBy('id', 'DESC');
    const queriedRows = query ? (await selection).filter(matchesQuery) : undefined;
    const total = queriedRows?.length ?? (typeof LogModel.count === 'function'
      ? await LogModel.count(where)
      : (await LogModel.select('id').where(where)).length);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    const logs = queriedRows
      ? queriedRows.slice(offset, offset + pageSize)
      : selection.offset
        ? await selection.offset(offset).limit(pageSize)
        : (await selection).slice(offset, offset + pageSize);
    // Source counts match level/q, but exclude the selected source and page window.
    const sourceRows = await LogModel.select('source', 'name', 'message').where(baseWhere);
    const counts = new Map<string, number>();
    for (const row of sourceRows) {
      const name = row.source;
      if (!name || !matchesQuery(row)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return jsonResponse(200, {
      success: true,
      data: logs.map((log) => ({
        id: log.id,
        level: log.level,
        name: log.name,
        message: log.message,
        source: log.source,
        timestamp: log.timestamp instanceof Date ? log.timestamp.toISOString() : log.timestamp,
      })),
      total, page, pageSize, totalPages,
      sources: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([source, count]) => ({ source, count })),
    });
  }, { summary: 'List system logs', tags: ['console', 'logs'] });

  route('DELETE', `${base}/logs`, async () => {
    const denied = requireWriteScope(ctx);
    if (denied) return denied;
    const LogModel = getModel();
    if (LogModel) {
      await LogModel.delete({});
    }
    return jsonResponse(200, { success: true, message: '日志已清空' });
  }, { summary: 'Clear system logs', tags: ['console', 'logs'] });

  route('GET', `${base}/logs/stats`, async () => {
    const LogModel = getModel();
    if (!LogModel) {
      return jsonResponse(200, {
        success: true,
        data: {
          total: 0,
          byLevel: { info: 0, warn: 0, error: 0 },
          oldestTimestamp: null,
        },
        note: unavailableNote,
      });
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

    return jsonResponse(200, {
      success: true,
      data: { total, byLevel: levelCounts, oldestTimestamp },
    });
  }, { summary: 'System log stats', tags: ['console', 'logs'] });

  route('POST', `${base}/logs/cleanup`, async (request) => {
    const denied = requireWriteScope(ctx);
    if (denied) return denied;
    const LogModel = getModel();
    if (!LogModel) {
      return jsonResponse(200, {
        success: true,
        message: '已清理 0 条日志',
        deletedCount: 0,
        note: unavailableNote,
      });
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

    return jsonResponse(200, {
      success: true,
      message: `已清理 ${deletedCount} 条日志`,
      deletedCount,
    });
  }, { summary: 'Cleanup old system logs', tags: ['console', 'logs'] });
}

/** Locale-keyed texts from an untrusted registry entry (reuses the published-manifest reader). */
function localizedTextOf(value: unknown): PluginLocalizedText | undefined {
  return readPluginMarketplaceMetadata({ metadata: { displayNameI18n: value } }).displayNameI18n;
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
  const registry = new MarketplaceRegistry({
    fetchFn,
    url: pluginRegistryUrl,
    ttlMs: PLUGINS_CACHE_TTL,
  });

  // The detail route is unauthenticated: cache the projected packument so repeated
  // requests cannot be used to hammer the npm registry.
  const details = new MarketplaceDetailCache<Record<string, unknown>>({
    ttlMs: PACKAGE_DETAIL_CACHE_TTL,
    maxEntries: PACKAGE_DETAIL_CACHE_MAX_ENTRIES,
    load: async (pkgName) => {
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
      // Marketplace fields come from the published manifest (`zhin.metadata`); the author is the
      // package's author / maintainers, never the publishing account (`_npmUser`, a release bot).
      const market = readPluginMarketplaceMetadata(latestInfo?.zhin);
      return {
        name: meta.name,
        version: latest,
        ...(market.displayName ? { displayName: market.displayName } : {}),
        ...(market.displayNameI18n ? { displayNameI18n: market.displayNameI18n } : {}),
        ...(market.descriptionI18n ? { descriptionI18n: market.descriptionI18n } : {}),
        ...(market.category ? { category: market.category } : {}),
        description: (latestInfo?.description as string | undefined) || meta.description || '',
        readme: meta.readme || '',
        license: meta.license || latestInfo?.license || '',
        homepage: meta.homepage || latestInfo?.homepage || '',
        repository:
          (meta.repository as { url?: string } | undefined)?.url ||
          (latestInfo?.repository as { url?: string } | undefined)?.url ||
          '',
        author: packageAuthorName(latestInfo ?? {}) ?? packageAuthorName(meta) ?? '',
        keywords: informativeKeywords(latestInfo?.keywords),
        engines: latestInfo?.engines || {},
        peerDependencies: latestInfo?.peerDependencies || {},
        versions: Object.keys(versions || {}),
        lastPublish: (latest && time?.[latest]) || '',
      };
    },
  });

  route('GET', '/pub/marketplace/search', async (_request, { url }) => {
    const q = url.searchParams.get('q') ?? url.searchParams.get('keyword') ?? '';
    const pageNum = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get('size') ?? url.searchParams.get('limit') ?? '20', 10) || 20),
    );
    const rawCategory = url.searchParams.get('category') || undefined;
    const category = rawCategory === undefined ? undefined : normalizePluginCategory(rawCategory) ?? rawCategory;
    const official = url.searchParams.get('official') ?? undefined;
    const rawLocale = url.searchParams.get('locale');
    const locale = isLocale(rawLocale) ? rawLocale : undefined;
    const searchKeyword = q.trim().toLowerCase();

    try {
      const allPlugins = (await registry.list()) as readonly Record<string, unknown>[];
      let plugins = allPlugins.map((p) => {
        const displayNameI18n = localizedTextOf(p.displayNameI18n);
        const descriptionI18n = localizedTextOf(p.descriptionI18n);
        const displayName = typeof p.displayName === 'string' ? p.displayName : '';
        const description = typeof p.description === 'string' ? p.description : '';
        return {
        name: p.name,
        // `locale` resolves the display texts for the caller; translations stay available either way.
        displayName: locale ? pickLocalizedText(displayNameI18n, locale, displayName) ?? '' : displayName,
        ...(displayNameI18n ? { displayNameI18n } : {}),
        version: p.version || '',
        description: locale ? pickLocalizedText(descriptionI18n, locale, description) ?? '' : description,
        ...(descriptionI18n ? { descriptionI18n } : {}),
        author: p.author || '',
        isOfficial: typeof p.name === 'string' && /^@zhin\.js\/[a-z0-9][a-z0-9._-]*$/.test(p.name),
        official: typeof p.name === 'string' && /^@zhin\.js\/[a-z0-9][a-z0-9._-]*$/.test(p.name),
        category: normalizePluginCategory(p.category) ?? 'utility',
        keywords: informativeKeywords(p.tags),
        npm: p.npm || `https://www.npmjs.com/package/${p.name}`,
        date: p.lastUpdate || '',
        downloads: p.downloads || { weekly: 0, monthly: 0 },
        readme: p.readme || '',
        license: p.license || '',
        };
      });

      if (searchKeyword) {
        plugins = plugins.filter((p) => {
          const haystack = [
            p.name, p.displayName, p.description,
            ...Object.values(p.displayNameI18n ?? {}), ...Object.values(p.descriptionI18n ?? {}),
            ...p.keywords,
          ]
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
      return jsonResponse(200, {
        success: true,
        data: items,
        total,
        page: pageNum,
        size: pageSize,
      });
    } catch (err) {
      logInternalError('marketplace_search_failed', err);
      return jsonResponse(502, {
        success: false,
        error: 'Search failed',
      });
    }
  }, { summary: 'Search plugin marketplace', tags: ['pub', 'marketplace'] });

  route('GET', '/pub/marketplace/detail/*', async (_request, { url }) => {
    const prefix = '/pub/marketplace/detail/';
    const rawName = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/\/+$/u, '')
      : '';
    if (!rawName) {
      return jsonResponse(404, { success: false, error: 'Package name is required' });
    }
    const pkgName = decodePathParam(rawName);
    if (!isValidNpmPackageName(pkgName)) {
      return jsonResponse(400, { success: false, error: 'Invalid package name' });
    }
    try {
      let cachedDownloads = { weekly: 0, monthly: 0 };
      try {
        const registryPlugins = (await registry.list()) as readonly {
          name?: string;
          downloads?: unknown;
        }[];
        const cached = registryPlugins.find((p) => p.name === pkgName);
        if (cached?.downloads && typeof cached.downloads === 'object') {
          cachedDownloads = cached.downloads as { weekly: number; monthly: number };
        }
      } catch {
        /* ignore cache miss */
      }

      const detail = await details.get(pkgName);
      return jsonResponse(200, {
        success: true,
        data: { ...detail, downloads: cachedDownloads },
      });
    } catch (err) {
      logInternalError('marketplace_detail_failed', err);
      return jsonResponse(502, {
        success: false,
        error: 'Detail fetch failed',
      });
    }
  }, { summary: 'Plugin marketplace detail', tags: ['pub', 'marketplace'] });

  route('GET', `${base}/marketplace/updates`, async () => {
    try {
      const installed = await listInstalledPluginPackages(ctx.projectRoot);
      if (!installed.length) {
        return jsonResponse(200, { success: true, data: [] });
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
      return jsonResponse(200, { success: true, data: updates.filter(Boolean) });
    } catch (err) {
      logInternalError('marketplace_updates_failed', err);
      return jsonResponse(500, {
        success: false,
        error: 'Update check failed',
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
