const API_BASE_KEY = "zhin_api_base";
const TOKEN_KEY = "zhin_api_token";

export function getApiBase(): string {
  const stored = localStorage.getItem(API_BASE_KEY)?.trim();
  if (stored) return trimTrailingSlash(stored);
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

export function setApiBase(base: string): void {
  localStorage.setItem(API_BASE_KEY, trimTrailingSlash(base));
}

export function getStoredToken(): string | null {
  const runtime = getRuntimeToken();
  if (runtime) return runtime;
  if (typeof localStorage !== "undefined") {
    const local = localStorage.getItem(TOKEN_KEY)?.trim();
    if (local) return local;
  }
  // Some login flows only persist to sessionStorage; keep transport in sync
  // with sandbox page / agent-stream which already read both stores.
  if (typeof sessionStorage !== "undefined") {
    const session = sessionStorage.getItem(TOKEN_KEY)?.trim();
    if (session) return session;
  }
  return null;
}

export function resolveApiUrl(path: string): string {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getRuntimeToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = (window as unknown as { __ZHIN_API_TOKEN?: string }).__ZHIN_API_TOKEN;
  return token?.trim() || null;
}
