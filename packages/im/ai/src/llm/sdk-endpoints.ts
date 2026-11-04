function trimUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** SDK factories concatenate paths; ordinary endpoint query options are applied by transport. */
export function withoutEndpointQuery(value: string): string {
  const url = new URL(value); url.search = ''; url.hash = '';
  return trimTrailingSlashes(url.href);
}

export function appendEndpointPath(value: string, suffix: string): string {
  const url = new URL(value);
  url.pathname = `${trimTrailingSlashes(url.pathname)}/${suffix.replace(/^\/+/, '')}`;
  return url.href;
}

export function normalizeAnthropicBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = trimUrl(baseUrl);
  if (!url) return undefined;
  const withoutTrailing = trimTrailingSlashes(url);
  if (withoutTrailing.endsWith('/v1')) return withoutTrailing;
  return `${withoutTrailing}/v1`;
}

/** @ai-sdk/google 默认 base 以 /v1beta 结尾；代理根路径须补此后缀 */
export function normalizeGoogleBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = trimUrl(baseUrl);
  if (!url) return undefined;
  const withoutTrailing = trimTrailingSlashes(url);
  if (withoutTrailing.endsWith('/v1beta')) return withoutTrailing;
  return `${withoutTrailing}/v1beta`;
}

/** A path segment that already names an API version: `v1`, `v3`, `v1beta`, `v2alpha1`. */
const API_VERSION_SEGMENT = /^v\d+(?:[a-z]+\d*)?$/i;

/**
 * OpenAI-compatible base URL. A bare host or a path without an API version gets
 * `/v1` (the historical behaviour: `https://gw.example` → `https://gw.example/v1`).
 * A base that already names a version anywhere in its path (`/api/v3`,
 * `/api/paas/v4`, `/v1beta/openai`, `/client/v4/.../ai/v1`) or ends in `/openai`
 * is used as written. `compat.appendV1` forces either behaviour.
 */
export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string, appendV1?: boolean): string {
  const url = trimTrailingSlashes(baseUrl.trim());
  if (appendV1 === false) return url;
  if (appendV1 === true) return url.endsWith('/v1') ? url : `${url}/v1`;
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; inspect it as a path.
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => API_VERSION_SEGMENT.test(segment))) return url;
  if (segments.at(-1)?.toLowerCase() === 'openai') return url;
  return `${url}/v1`;
}

/**
 * OpenAI base URL. Unset keeps the SDK default (`https://api.openai.com/v1`). A
 * proxy root gets `/v1` like the other OpenAI-style providers; a base that already
 * names a version or ends in `/openai` (Azure-style, Gemini OpenAI-compat) is kept.
 */
export function normalizeOpenAiBaseUrl(
  baseUrl: string | undefined,
  appendV1?: boolean,
): string | undefined {
  const url = trimUrl(baseUrl);
  return url ? normalizeOpenAiCompatibleBaseUrl(url, appendV1) : undefined;
}

/**
 * MiniMax (Anthropic protocol). The SDK posts to `${baseURL}/messages`, so a base
 * ending in `/anthropic` gets `/v1`, and a bare host gets `/anthropic/v1`
 * (`https://api.minimaxi.com` → `https://api.minimaxi.com/anthropic/v1`).
 */
export function normalizeMiniMaxBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = trimUrl(baseUrl);
  if (!url) return undefined;
  const withoutTrailing = trimTrailingSlashes(url);
  if (withoutTrailing.endsWith('/anthropic')) return `${withoutTrailing}/v1`;
  try {
    const { pathname } = new URL(withoutTrailing);
    if (pathname === '' || pathname === '/') return `${withoutTrailing}/anthropic/v1`;
  } catch {
    // Not an absolute URL; use as written.
  }
  return withoutTrailing;
}


function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}
