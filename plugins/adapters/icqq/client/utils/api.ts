const TOKEN_KEY = "zhin_api_token";
const API_BASE_KEY = "zhin_api_base";

export function getApiBase(): string {
  const stored = localStorage.getItem(API_BASE_KEY)?.trim();
  if (stored) return stored.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const base = getApiBase();
  const url =
    typeof input === "string" && input.startsWith("/") ? `${base}${input}` : input;

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new CustomEvent("zhin:auth-required"));
  }
  return res;
}
