export function getSandboxApiBase(): string {
  const stored = localStorage.getItem("zhin_api_base")?.trim();
  return (stored ? stored.replace(/\/$/, "") : null) ?? window.location.origin;
}

export function getSandboxAuthHeaders(): Record<string, string> {
  const token =
    localStorage.getItem("HTTP_TOKEN")?.trim() ||
    localStorage.getItem("zhin_http_token")?.trim() ||
    "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}
