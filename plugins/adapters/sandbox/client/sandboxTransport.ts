export type SandboxTransportMode = "websocket" | "http-sse";

export function getSandboxApiBase(): string {
  const stored = localStorage.getItem("zhin_api_base")?.trim();
  return (stored ? stored.replace(/\/$/, "") : null) ?? window.location.origin;
}

export function getSandboxSessionId(): string {
  const key = "zhin_sandbox_session";
  let id = sessionStorage.getItem(key)?.trim();
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function getSandboxAuthHeaders(): Record<string, string> {
  const token =
    localStorage.getItem("HTTP_TOKEN")?.trim() ||
    localStorage.getItem("zhin_http_token")?.trim() ||
    "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Edge 构建的 sandbox.mjs 带 ?v=edge 或 ?transport=http-sse */
export function transportFromModuleUrl(): SandboxTransportMode | null {
  try {
    const u = new URL(import.meta.url);
    if (u.searchParams.get("transport") === "http-sse") return "http-sse";
    if (u.searchParams.get("v") === "edge") return "http-sse";
  } catch {
    /* 非 ESM 环境 */
  }
  return null;
}

async function fetchTransportHint(apiBase: string, path: string): Promise<SandboxTransportMode | null> {
  const res = await fetch(new URL(path, `${apiBase.replace(/\/$/, "")}/`).href);
  if (!res.ok) return null;
  const data = (await res.json()) as { sandboxTransport?: string };
  return data.sandboxTransport === "http-sse" ? "http-sse" : null;
}

export async function resolveSandboxTransport(apiBase: string): Promise<SandboxTransportMode> {
  const fromModule = transportFromModuleUrl();
  if (fromModule) return fromModule;

  const override = localStorage.getItem("zhin_sandbox_transport")?.trim();
  if (override === "http-sse" || override === "websocket") return override;

  for (const path of ["/entries", "/api/info"]) {
    try {
      const mode = await fetchTransportHint(apiBase, path);
      if (mode) return mode;
    } catch {
      /* CORS / 离线 */
    }
  }
  return "websocket";
}
