import { apiFetch } from '../console-utils/remoteApi.js';

interface PageEntry {
  readonly owner?: string;
  readonly localName?: string;
  readonly source?: string;
  readonly route?: string;
}

export interface ResolvePluginIdOptions {
  /** 显式指定的 PluginId；非空时直接返回。 */
  readonly pluginId?: string;
  /** 适配器 key：匹配工作区 `adapters/<key>/pages/` 与 npm 包 `adapter-<key>/pages/` 两种来源。 */
  readonly adapter?: string;
  /** 不按适配器约定时，直接给出页面来源的匹配规则（任一命中即可）。 */
  readonly source?: RegExp | readonly RegExp[];
  /** 页面 localName，默认 `index`。 */
  readonly localName?: string;
  /** Host 读取失败或没有匹配页面时返回它，而不是 `undefined` / 抛错。 */
  readonly fallback?: string;
}

const BUILTIN_CONSOLE_ROUTES = new Set([
  'dashboard',
  'chat',
  'logs',
  'bots',
  'plugins',
  'market',
  'config',
  'env',
  'files',
  'database',
  'personal-models',
  'inference',
  'Endpoints',
  'endpoints',
  'login',
  'console',
  'pages',
  'unknown',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourcePatterns(options: ResolvePluginIdOptions): readonly RegExp[] {
  if (options.source) return Array.isArray(options.source) ? options.source : [options.source as RegExp];
  if (!options.adapter) throw new TypeError('resolvePluginId needs an `adapter` key or a `source` pattern');
  const key = escapeRegExp(options.adapter);
  return [new RegExp(`adapters[\\/]${key}[\\/]pages[\\/]`, 'u'), new RegExp(`adapter-${key}[\\/]pages[\\/]`, 'u')];
}

function currentPathname(): string {
  if (typeof location === 'undefined' || typeof location.pathname !== 'string') return '';
  return location.pathname.replace(/\/+$/u, '') || '/';
}

/**
 * 同步从显式参数、DOM `[data-zhin-plugin-id]`、`globalThis.__ZHIN_ACTIVE_PLUGIN_ID__`
 * 或当前 URL 路径解析插件 ID。
 */
export function resolveSyncPluginId(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }
  const pathname = currentPathname();
  if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
    const el = document.querySelector('[data-zhin-plugin-id]');
    const attr = el?.getAttribute?.('data-zhin-plugin-id')?.trim();
    if (attr) return attr;
  }
  const g = globalThis as Record<string, unknown>;
  const owners = g.__ZHIN_PAGE_OWNERS__ as Readonly<Record<string, string>> | undefined;
  if (pathname && owners && typeof owners[pathname] === 'string' && owners[pathname]!.trim()) {
    return owners[pathname]!.trim();
  }
  if (typeof g.__ZHIN_ACTIVE_PLUGIN_ID__ === 'string' && g.__ZHIN_ACTIVE_PLUGIN_ID__.trim()) {
    return g.__ZHIN_ACTIVE_PLUGIN_ID__.trim();
  }
  if (pathname) {
    const pluginRouteMatch = /^\/plugins\/([^/]+)/u.exec(pathname);
    if (pluginRouteMatch?.[1]) return pluginRouteMatch[1];
    const adapterRouteMatch = /^\/adapters\/([^/]+)/u.exec(pathname);
    if (adapterRouteMatch?.[1]) return adapterRouteMatch[1];
    const nestedPageMatch = /^\/(.+)\/p-([^/]+)$/u.exec(pathname);
    if (nestedPageMatch?.[1]) return nestedPageMatch[1];
    const rootPageMatch = /^\/p-([^/]+)/u.exec(pathname);
    if (rootPageMatch?.[1]) return rootPageMatch[1];
    const singleSegMatch = /^\/([^/]+)$/u.exec(pathname);
    if (singleSegMatch?.[1]) {
      const seg = singleSegMatch[1];
      if (!BUILTIN_CONSOLE_ROUTES.has(seg) && !BUILTIN_CONSOLE_ROUTES.has(seg.toLowerCase())) {
        return seg;
      }
    }
  }
  return 'unknown';
}

async function resolvePluginIdFromCatalog(options: ResolvePluginIdOptions): Promise<string | undefined> {
  if (typeof options.pluginId === 'string' && options.pluginId.trim().length > 0) {
    return options.pluginId.trim();
  }
  const patterns = sourcePatterns(options);
  const localName = options.localName ?? 'index';
  const pathname = currentPathname();
  try {
    const response = await apiFetch('/console/api/pages');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { pages?: readonly PageEntry[] };
    const candidates = (body.pages ?? []).filter((page): page is PageEntry & { owner: string; source: string } =>
      page.localName === localName && typeof page.owner === 'string' && typeof page.source === 'string'
      && patterns.some((pattern) => pattern.test(page.source as string)));
    const exact = candidates.filter((page) => page.route === pathname);
    const owner = exact.length === 1 ? exact[0]?.owner
      : exact.length === 0 && candidates.length === 1 ? candidates[0]?.owner : undefined;
    return owner ?? options.fallback;
  } catch (error) {
    if (options.fallback !== undefined) return options.fallback;
    throw error;
  }
}

/**
 * 解析当前页面所属的 PluginId：
 * - 传入字符串或省略参数时：同步从显式值、`[data-zhin-plugin-id]`、`globalThis.__ZHIN_ACTIVE_PLUGIN_ID__` 或 URL 路径解析。
 * - 传入 `{ adapter, source, localName, fallback }` 时：从当前已认证 Host 的 `/console/api/pages` 解析页面所属的 PluginId。
 */
export function resolvePluginId(explicit?: string): string;
export function resolvePluginId(options: ResolvePluginIdOptions): Promise<string | undefined>;
export function resolvePluginId(
  arg?: string | ResolvePluginIdOptions,
): string | Promise<string | undefined> {
  if (arg !== undefined && typeof arg === 'object' && arg !== null) {
    return resolvePluginIdFromCatalog(arg);
  }
  return resolveSyncPluginId(arg);
}

/** 适配器 Console 页的便捷写法：等价于 `resolvePluginId({ adapter })`。 */
export function resolveAdapterConsolePluginId(adapterKey: string): Promise<string | undefined> {
  return resolvePluginId({ adapter: adapterKey });
}
