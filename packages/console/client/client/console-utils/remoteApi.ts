const TOKEN_KEY = "zhin_api_token";
const API_BASE_KEY = "zhin_api_base";

export function getApiBase(): string {
  const stored = localStorage.getItem(API_BASE_KEY)?.trim();
  if (stored) return trimTrailingSlash(stored);
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function getToken(): string | null {
  const runtime = getRuntimeToken();
  if (runtime) return runtime;
  if (typeof localStorage !== "undefined") {
    const local = localStorage.getItem(TOKEN_KEY)?.trim();
    if (local) return local;
  }
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

export function resolveWebSocketUrl(path: string): string {
  const httpUrl = resolveApiUrl(path);
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/** fetch with Bearer token; relative paths resolve against {@link getApiBase}. */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const url =
    typeof input === "string" && input.startsWith("/")
      ? resolveApiUrl(input)
      : input;

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new CustomEvent("zhin:auth-required"));
  }
  return res;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getRuntimeToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = (window as unknown as { __ZHIN_API_TOKEN?: string }).__ZHIN_API_TOKEN;
  return token?.trim() || null;
}
