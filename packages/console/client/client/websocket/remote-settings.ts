const API_BASE_KEY = "zhin_api_base";
const TOKEN_KEY = "zhin_api_token";

export function getApiBase(): string {
  const stored = localStorage.getItem(API_BASE_KEY)?.trim();
  if (stored) return stored.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

export function setApiBase(base: string): void {
  localStorage.setItem(API_BASE_KEY, base.replace(/\/$/, ""));
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function resolveApiUrl(path: string): string {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
