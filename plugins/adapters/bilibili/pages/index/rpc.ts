import { apiFetch, pluginRpc } from '@zhin.js/client';

/** 与插件 `src/console.ts` 返回的结构保持一致（只读视图）。 */
export interface ReviewDraft {
  readonly id: string;
  readonly url: string;
  /** 评论区标签（兼容旧字段名）：`av123` / `cv456` / `dynamic 789`。 */
  readonly video: string;
  readonly resource?: string;
  readonly message: string;
  readonly status: 'pending' | 'sending';
  readonly interrupted: boolean;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly author?: string;
  readonly original?: string;
}

export interface ReviewEndpoint {
  readonly id: string;
  readonly sendMode: 'review' | 'off';
  readonly persistent: boolean;
  readonly circuit: { readonly code: number } | null;
  readonly login: {
    readonly state: 'none' | 'ok' | 'expired';
    readonly source?: 'config' | 'qr';
    readonly mid?: string;
    readonly uname?: string;
    readonly expiresAt?: number;
  };
  readonly qr: {
    readonly state: 'idle' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'failed';
    readonly image?: string;
    readonly expiresAt?: number;
    readonly error?: string;
  };
  readonly videos: readonly { readonly ref: string; readonly url: string; readonly aid?: string }[];
  /** 白名单动态 / 专栏；动态解析失败时带 `error`。 */
  readonly resources?: readonly {
    readonly kind: 'dynamic' | 'article';
    readonly ref: string;
    readonly url: string;
    readonly commentType?: number;
    readonly oid?: string;
    readonly error?: string;
  }[];
  readonly pendingCount: number;
  readonly drafts: readonly ReviewDraft[];
}

export interface ReviewStatus {
  readonly endpoints: readonly ReviewEndpoint[];
  readonly updatedAt: number;
}

interface PageEntry {
  readonly owner?: string;
  readonly localName?: string;
  readonly source?: string;
  readonly route?: string;
}

const FALLBACK_PLUGIN_ID = 'root/bilibili';
/** 进程内缓存：用 const 容器持有，避免模块级可变绑定（adapter endpoint 边界检查）。 */
const pluginIdCache: { promise?: Promise<string> } = {};

/**
 * 找到本插件的 PluginId（插件实例名可以不是 bilibili）：从页面清单里挑出本包的 index 页，
 * 优先匹配当前地址；找不到时退回 `root/bilibili`。
 */
export function resolvePluginId(): Promise<string> {
  pluginIdCache.promise ??= (async () => {
    try {
      const response = await apiFetch('/console/api/pages');
      if (!response.ok) return FALLBACK_PLUGIN_ID;
      const body = await response.json() as { pages?: readonly PageEntry[] };
      const candidates = (body.pages ?? []).filter(page => page.localName === 'index' && typeof page.owner === 'string'
        && typeof page.source === 'string' && /adapter-bilibili|adapters[\\/]bilibili[\\/]pages/.test(page.source));
      const here = typeof location === 'undefined' ? '' : location.pathname.replace(/\/+$/, '') || '/';
      const match = candidates.find(page => page.route === here) ?? candidates[0];
      return match?.owner ?? FALLBACK_PLUGIN_ID;
    } catch {
      return FALLBACK_PLUGIN_ID;
    }
  })();
  return pluginIdCache.promise;
}

export async function call<T>(method: string, data?: Record<string, unknown>): Promise<T> {
  return pluginRpc<T>(await resolvePluginId(), method, data);
}
