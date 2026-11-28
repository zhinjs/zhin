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

export interface SandboxRequestContext {
  readonly apiBase: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Capture once for a request owner; credentials stay in its closure, never UI state or storage. */
export function captureSandboxRequestContext(): SandboxRequestContext {
  return Object.freeze({ apiBase: getSandboxApiBase(), headers: Object.freeze(getSandboxAuthHeaders()) });
}

/** The path the first Sandbox account on a Host serves; every account also serves `/sandbox/<id>`. */
export const SANDBOX_DEFAULT_WS_PATH = '/sandbox';

/** Per-viewer choice of the Sandbox account (its WebSocket path); a convenience, never authoritative. */
export const SANDBOX_WS_PATH_STORAGE_KEY = 'zhin_sandbox_ws_path';

/** `/sandbox` or one account's `/sandbox/<id>`: nothing else is ever connected to. */
export function isSandboxWsPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/sandbox(?:\/[^/?#\s]+)?$/u.test(value);
}

/** One Sandbox account on the connected Host (`ready.endpoints`, #1250). */
export interface SandboxEndpointOption {
  readonly id: string;
  readonly path: string;
  readonly default: boolean;
}

/** The accounts a `ready` frame lists; an older Host lists none. */
export function sandboxEndpointOptions(value: unknown): readonly SandboxEndpointOption[] {
  if (!Array.isArray(value)) return [];
  return Object.freeze(value.flatMap((item) => {
    const entry = item as { id?: unknown; path?: unknown; default?: unknown } | null;
    return entry && typeof entry.id === 'string' && entry.id && isSandboxWsPath(entry.path)
      ? [Object.freeze({ id: entry.id, path: entry.path, default: entry.default === true })] : [];
  }));
}

/** The account path this viewer chose, if any (storage may be unavailable). */
export function readSandboxWsPath(): string | undefined {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(SANDBOX_WS_PATH_STORAGE_KEY);
    return isSandboxWsPath(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers (or with `undefined` forgets) the chosen account path. */
export function writeSandboxWsPath(path: string | undefined): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (path && isSandboxWsPath(path)) localStorage.setItem(SANDBOX_WS_PATH_STORAGE_KEY, path);
    else if (typeof localStorage.removeItem === 'function') localStorage.removeItem(SANDBOX_WS_PATH_STORAGE_KEY);
    else localStorage.setItem(SANDBOX_WS_PATH_STORAGE_KEY, '');
  } catch { /* silent-ok: the choice is a per-viewer convenience */ }
}

/**
 * Browser WebSocket cannot set Authorization reliably; pass token in query when needed.
 * Uses stored Console API base so Remote Console (different origin) still hits the bot Host.
 */
export function buildSandboxWebSocketUrl(base?: string, path: string = SANDBOX_DEFAULT_WS_PATH): string {
  const apiBase = (base ?? getSandboxApiBase()).replace(/\/+$/u, '');
  const origin = apiBase || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const wsUrl = new URL(isSandboxWsPath(path) ? path : SANDBOX_DEFAULT_WS_PATH, `${origin}/`);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getSandboxBearerToken();
  if (token) wsUrl.searchParams.set('token', token);
  return wsUrl.href;
}

export const SANDBOX_SCOPED_PROTOCOL = 'scoped-conversations-v1';

/** A successful send means queued on this socket, never accepted by the Agent or an approval policy. */
export function submitSandboxFrame(
  socket: Pick<WebSocket, 'readyState' | 'send'> | null,
  frame: Readonly<Record<string, unknown>>,
): boolean {
  if (!socket || socket.readyState !== 1) return false;
  try {
    socket.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

/** UUID v4 using Web Crypto, including ordinary HTTP LAN pages without randomUUID(). */
export function createSandboxMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
