import { apiFetch } from '../console-utils/remoteApi.js';

interface PageEntry {
  readonly owner?: string;
  readonly localName?: string;
  readonly source?: string;
  readonly route?: string;
}

export interface ResolvePluginIdOptions {
  /** 适配器 key：匹配工作区 `adapters/<key>/pages/` 与 npm 包 `adapter-<key>/pages/` 两种来源。 */
  readonly adapter?: string;
  /** 不按适配器约定时，直接给出页面来源的匹配规则（任一命中即可）。 */
  readonly source?: RegExp | readonly RegExp[];
  /** 页面 localName，默认 `index`。 */
  readonly localName?: string;
  /** Host 读取失败或没有匹配页面时返回它，而不是 `undefined` / 抛错。 */
  readonly fallback?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourcePatterns(options: ResolvePluginIdOptions): readonly RegExp[] {
  if (options.source) return Array.isArray(options.source) ? options.source : [options.source as RegExp];
  if (!options.adapter) throw new TypeError('resolvePluginId needs an `adapter` key or a `source` pattern');
  const key = escapeRegExp(options.adapter);
  return [new RegExp(`adapters[\\/]${key}[\\/]pages[\\/]`, 'u'), new RegExp(`adapter-${key}[\\/]pages[\\/]`, 'u')];
}

/**
 * 从当前已认证 Host 的 `/console/api/pages` 解析页面所属的 PluginId。
 * 优先匹配当前地址对应的路由；没有精确匹配时仅在候选唯一才返回，不会猜。
 * 不做跨 Host 缓存：归属每次都从当前 Host 读取。
 */
export async function resolvePluginId(options: ResolvePluginIdOptions): Promise<string | undefined> {
  const patterns = sourcePatterns(options);
  const localName = options.localName ?? 'index';
  const pathname = typeof location === 'undefined' ? '' : location.pathname.replace(/\/+$/u, '') || '/';
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

/** 适配器 Console 页的便捷写法：等价于 `resolvePluginId({ adapter })`。 */
export function resolveAdapterConsolePluginId(adapterKey: string): Promise<string | undefined> {
  return resolvePluginId({ adapter: adapterKey });
}
