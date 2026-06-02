/**
 * 插件市场 REST（仅依赖 global fetch）。
 */
import type { Plugin } from "@zhin.js/core";
import {
  paramPath,
  registerFetchRoute,
  type Router,
  type RouterContext,
} from "@zhin.js/host-router/router";

let pluginsCache: { data: unknown[]; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function fetchPluginRegistry(): Promise<unknown[]> {
  if (pluginsCache && Date.now() - pluginsCache.ts < CACHE_TTL) return pluginsCache.data;
  const resp = await fetch("https://zhin.js.org/plugins.json");
  if (!resp.ok) throw new Error(`plugins.json fetch failed: ${resp.status}`);
  const json = (await resp.json()) as { plugins?: unknown[] };
  const list = json.plugins || [];
  pluginsCache = { data: list, ts: Date.now() };
  return list;
}

export function registerMarketplacePubRoutes(router: Router): void {
  registerFetchRoute(router, "GET", "/pub/marketplace/search", async (ctx: RouterContext) => {
    const q = String(ctx.query.q ?? ctx.query.keyword ?? "");
    const page = String(ctx.query.page ?? "1");
    const size = String(ctx.query.size ?? ctx.query.limit ?? "20");
    const category = ctx.query.category ? String(ctx.query.category) : undefined;
    const official = ctx.query.official ? String(ctx.query.official) : undefined;
    const searchKeyword = q.trim().toLowerCase();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(size, 10) || 20));

    try {
      const allPlugins = (await fetchPluginRegistry()) as Array<Record<string, unknown>>;
      let plugins = allPlugins.map((p) => ({
        name: p.name,
        displayName: p.displayName || "",
        version: p.version || "",
        description: p.description || "",
        author: p.author || "",
        isOfficial: !!p.isOfficial,
        official: !!p.isOfficial,
        category: p.category || "util",
        keywords: (p.tags as string[]) || [],
        npm: p.npm || `https://www.npmjs.com/package/${p.name}`,
        date: p.lastUpdate || "",
        downloads: p.downloads || { weekly: 0, monthly: 0 },
        readme: p.readme || "",
        license: p.license || "",
      }));

      if (searchKeyword) {
        plugins = plugins.filter((p) => {
          const haystack = [p.name, p.displayName, p.description, ...(p.keywords || [])]
            .join(" ")
            .toLowerCase();
          return haystack.includes(searchKeyword);
        });
      }
      if (category) plugins = plugins.filter((p) => p.category === category);
      if (official === "true") plugins = plugins.filter((p) => p.official);
      if (official === "false") plugins = plugins.filter((p) => !p.official);

      const total = plugins.length;
      const start = (pageNum - 1) * pageSize;
      const items = plugins.slice(start, start + pageSize);
      ctx.body = { success: true, data: items, total, page: pageNum, size: pageSize };
    } catch (err) {
      ctx.status = 502;
      ctx.body = {
        success: false,
        error: err instanceof Error ? err.message : "Search failed",
      };
    }
  });

  registerFetchRoute(router, "GET", "/pub/marketplace/detail/:name+", async (ctx: RouterContext) => {
    const pkgName = paramPath(ctx, "name");
    try {
      let cachedDownloads = { weekly: 0, monthly: 0 };
      try {
        const registry = (await fetchPluginRegistry()) as Array<{ name?: string; downloads?: unknown }>;
        const cached = registry.find((p) => p.name === pkgName);
        if (cached?.downloads && typeof cached.downloads === "object") {
          cachedDownloads = cached.downloads as { weekly: number; monthly: number };
        }
      } catch {
        /* ignore cache miss */
      }

      const metaResp = await fetch(
        `https://registry.npmmirror.com/${encodeURIComponent(pkgName)}`,
      );
      if (!metaResp.ok) throw new Error(`Package not found: ${metaResp.status}`);
      const meta = (await metaResp.json()) as Record<string, unknown>;
      const latest = (meta["dist-tags"] as Record<string, string> | undefined)?.latest;
      const versions = meta.versions as Record<string, Record<string, unknown>> | undefined;
      const latestInfo = latest && versions ? versions[latest] : undefined;
      const time = meta.time as Record<string, string> | undefined;
      ctx.body = {
        success: true,
        data: {
          name: meta.name,
          version: latest,
          description: meta.description || "",
          readme: meta.readme || "",
          license: meta.license || latestInfo?.license || "",
          homepage: meta.homepage || latestInfo?.homepage || "",
          repository:
            (meta.repository as { url?: string } | undefined)?.url ||
            (latestInfo?.repository as { url?: string } | undefined)?.url ||
            "",
          author:
            typeof meta.author === "string"
              ? meta.author
              : (meta.author as { name?: string } | undefined)?.name || "",
          keywords: (latestInfo?.keywords as string[]) || [],
          engines: latestInfo?.engines || {},
          peerDependencies: latestInfo?.peerDependencies || {},
          downloads: cachedDownloads,
          versions: Object.keys(versions || {}),
          lastPublish: (latest && time?.[latest]) || "",
        },
      };
    } catch (err) {
      ctx.status = 502;
      ctx.body = {
        success: false,
        error: err instanceof Error ? err.message : "Detail fetch failed",
      };
    }
  });
}

export function registerMarketplaceUpdatesRoute(
  router: Router,
  base: string,
  getRoot: () => Plugin,
): void {
  registerFetchRoute(router, "GET", `${base}/marketplace/updates`, async (ctx: RouterContext) => {
    try {
      const configService = getRoot().inject("config");
      const appConfig = configService?.getPrimary<{ plugins?: string[] }>();
      const installed: string[] = appConfig?.plugins || [];
      if (!installed.length) {
        ctx.body = { success: true, data: [] };
        return;
      }
      const updates = await Promise.all(
        installed.map(async (name: string) => {
          try {
            const resp = await fetch(
              `https://registry.npmmirror.com/${encodeURIComponent(name)}/latest`,
            );
            if (!resp.ok) return null;
            const pkg = (await resp.json()) as { version?: string; description?: string };
            return { name, latest: pkg.version, description: pkg.description || "" };
          } catch {
            return null;
          }
        }),
      );
      ctx.body = { success: true, data: updates.filter(Boolean) };
    } catch (err) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: err instanceof Error ? err.message : "Update check failed",
      };
    }
  });
}

export function registerMarketplaceRoutes(
  router: Router,
  base: string,
  getRoot: () => Plugin,
): void {
  registerMarketplacePubRoutes(router);
  registerMarketplaceUpdatesRoute(router, base, getRoot);
}
