/** Same storage keys as `@zhin.js/client` remoteApi. */

export function getSandboxApiBase(): string {
  if (typeof localStorage === 'undefined') {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }
  const stored = localStorage.getItem('zhin_api_base')?.trim();
  if (stored) return stored.replace(/\/+$/u, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function getSandboxBearerToken(): string {
  if (typeof window !== 'undefined') {
    const runtime = (window as unknown as { __ZHIN_API_TOKEN?: string }).__ZHIN_API_TOKEN?.trim();
    if (runtime) return runtime;
  }
  if (typeof localStorage === 'undefined') return '';
  return (
    localStorage.getItem('zhin_api_token')?.trim()
    || localStorage.getItem('HTTP_TOKEN')?.trim()
    || localStorage.getItem('zhin_http_token')?.trim()
    || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('zhin_api_token')?.trim() : '')
    || ''
  );
}

export function getSandboxAuthHeaders(): Record<string, string> {
  const token = getSandboxBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Browser WebSocket cannot set Authorization reliably; pass token in query when needed.
 * Uses stored Console API base so Remote Console (different origin) still hits the bot Host.
 */
export function buildSandboxWebSocketUrl(base?: string): string {
  const apiBase = (base ?? getSandboxApiBase()).replace(/\/+$/u, '');
  const origin = apiBase || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const wsUrl = new URL('/sandbox', `${origin}/`);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getSandboxBearerToken();
  if (token) wsUrl.searchParams.set('token', token);
  return wsUrl.href;
}
