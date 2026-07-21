export function getSandboxApiBase(): string {
  const stored = localStorage.getItem("zhin_api_base")?.trim();
  return (stored ? stored.replace(/\/$/, "") : null) ?? window.location.origin;
}

export function getSandboxBearerToken(): string {
  return (
    localStorage.getItem("zhin_api_token")?.trim() ||
    localStorage.getItem("HTTP_TOKEN")?.trim() ||
    localStorage.getItem("zhin_http_token")?.trim() ||
    ""
  );
}

export function getSandboxAuthHeaders(): Record<string, string> {
  const token = getSandboxBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Browser WebSocket cannot set Authorization reliably; pass token in query when needed. */
export function buildSandboxWebSocketUrl(base?: string): string {
  const apiBase = (base ?? getSandboxApiBase()).replace(/\/$/, "");
  const wsUrl = new URL("/sandbox", `${apiBase}/`);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  const token = getSandboxBearerToken();
  if (token) wsUrl.searchParams.set("token", token);
  return wsUrl.href;
}
