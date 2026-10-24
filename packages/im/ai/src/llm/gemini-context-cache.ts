/**
 * Explicit Gemini context caching (`cachedContents`), opt-in per provider via
 * `contextCache: { mode: 'explicit' }`. Implicit caching (the default) needs no
 * code: Gemini discounts a repeated prefix on its own, and zhin keeps the system
 * prompt and tools byte-stable so the prefix repeats.
 *
 * Explicit mode wraps the provider's fetch. Before a generateContent call it
 * caches the stable prefix (systemInstruction + tools + toolConfig) once per
 * distinct prefix, then sends `cachedContent` instead of that prefix. The API
 * rejects requests that set both, so the prefix fields are removed.
 *
 * - TTL: each cache lives `ttlSeconds` (default 600). It is re-created once
 *   fewer than {@link REFRESH_MARGIN_MS} remain.
 * - Invalidation: a changed prefix gets a new cache and the old one is deleted
 *   (best effort, to stop storage billing). If a request using a cache fails
 *   with 400/403/404 (expired or deleted on the server), the entry is dropped
 *   and the original request is sent once without it.
 * - Fallback: if creating a cache fails (for example below the model's minimum
 *   cacheable size), that prefix is not tried again for one TTL, and requests
 *   go out unchanged, so implicit caching still applies.
 *
 * Explicit caching works on Gemini 3 / 2.5 via generateContent. Gemini 4 Argon
 * and later do not support it (ai.google.dev/gemini-api/docs/caching).
 */
import { createHash } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';

export interface GeminiContextCacheConfig {
  /** `implicit` (default) leaves requests untouched. `explicit` creates cachedContents. */
  readonly mode?: 'implicit' | 'explicit';
  /** Lifetime of each created cache. Default 600. */
  readonly ttlSeconds?: number;
  /** Prefixes shorter than this (characters of JSON) are not worth a cache. Default 8000 (~2k tokens). */
  readonly minPrefixChars?: number;
}

export const REFRESH_MARGIN_MS = 30_000;
const GENERATE_URL = /\/models\/([^/:?]+):(?:streamGenerateContent|generateContent)/;
const PREFIX_FIELDS = ['systemInstruction', 'tools', 'toolConfig'] as const;

interface Entry {
  readonly name?: string;
  readonly expiresAt: number;
}

export interface GeminiContextCacheStats {
  created: number;
  reused: number;
  deleted: number;
  failed: number;
}

export function createGeminiCachingFetch(
  config: GeminiContextCacheConfig,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
  now: () => number = Date.now,
): typeof globalThis.fetch & { readonly stats: GeminiContextCacheStats } {
  const ttlMs = Math.max(60, config.ttlSeconds ?? 600) * 1000;
  const minPrefixChars = config.minPrefixChars ?? 8_000;
  const entries = new Map<string, Entry>();
  const stats: GeminiContextCacheStats = { created: 0, reused: 0, deleted: 0, failed: 0 };
  const currentKeyByModel = new Map<string, string>();

  async function remove(url: string, name: string, headers: HeadersInit | undefined): Promise<void> {
    stats.deleted += 1;
    await baseFetch(`${apiRoot(url)}/${name}`, { method: 'DELETE', headers }).catch(() => undefined);
  }

  async function resolveCache(url: string, model: string, body: Record<string, unknown>, headers: HeadersInit | undefined): Promise<string | undefined> {
    const prefix = Object.fromEntries(PREFIX_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
    const serialized = JSON.stringify(prefix);
    if (serialized.length < minPrefixChars) return undefined;
    const key = createHash('sha256').update(model).update('\0').update(serialized).digest('hex');

    const previousKey = currentKeyByModel.get(model);
    if (previousKey && previousKey !== key) {
      const stale = entries.get(previousKey);
      entries.delete(previousKey);
      if (stale?.name) await remove(url, stale.name, headers);
    }
    currentKeyByModel.set(model, key);

    const entry = entries.get(key);
    if (entry && entry.expiresAt - now() > REFRESH_MARGIN_MS) {
      if (entry.name) stats.reused += 1;
      return entry.name;
    }
    const response = await baseFetch(`${apiRoot(url)}/cachedContents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: `models/${model}`, ...prefix, ttl: `${Math.round(ttlMs / 1000)}s` }),
    }).catch(() => undefined);
    const created = response?.ok ? await response.json().catch(() => undefined) as { name?: unknown } | undefined : undefined;
    if (typeof created?.name !== 'string') {
      // Remember the failure for one TTL so every request does not pay for a doomed create.
      stats.failed += 1;
      entries.set(key, { expiresAt: now() + ttlMs });
      getLogger('ai-context-cache').warn(formatCompact({
        op: 'gemini_cache_create',
        model,
        status: response?.status,
        reason: !response ? 'network_error' : response.ok ? 'invalid_response' : 'http_error',
        fallback: 'implicit',
      }));
      return undefined;
    }
    stats.created += 1;
    entries.set(key, { name: created.name, expiresAt: now() + ttlMs });
    return created.name;
  }

  const cachingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const match = GENERATE_URL.exec(url);
    if (!match || typeof init?.body !== 'string') return baseFetch(input, init);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return baseFetch(input, init);
    }
    if (body.cachedContent) return baseFetch(input, init);
    const model = decodeURIComponent(match[1]!);
    const name = await resolveCache(url, model, body, init.headers);
    if (!name) return baseFetch(input, init);

    const slim: Record<string, unknown> = { ...body, cachedContent: name };
    for (const field of PREFIX_FIELDS) delete slim[field];
    const response = await baseFetch(input, { ...init, body: JSON.stringify(slim) });
    if (response.status === 400 || response.status === 403 || response.status === 404) {
      // The cache expired or was deleted server-side: drop it and send the request as it was.
      for (const [key, entry] of entries) if (entry.name === name) entries.delete(key);
      return baseFetch(input, init);
    }
    return response;
  }) as typeof globalThis.fetch & { stats: GeminiContextCacheStats };
  cachingFetch.stats = stats;
  return cachingFetch;
}

function apiRoot(url: string): string {
  return url.replace(/\?.*$/, '').replace(/\/models\/[^/]+$/, '');
}
