/**
 * Build public base URL for Agent Card interfaces.
 */
export function resolvePublicBaseUrl(config: {
  http?: { host?: string; port?: number; publicUrl?: string };
}): string {
  const http = config.http ?? {};
  if (http.publicUrl?.trim()) {
    return http.publicUrl.trim().replace(/\/$/, '');
  }
  const host = http.host?.trim() || '127.0.0.1';
  const port = http.port ?? 8086;
  const hostname = host === '0.0.0.0' ? '127.0.0.1' : host;
  return `http://${hostname}:${port}`;
}

export function a2aAgentBasePath(agentName: string): string {
  return `/a2a/${encodeURIComponent(agentName)}`;
}

export function a2aJsonRpcUrl(publicBase: string, agentName: string): string {
  return `${publicBase}${a2aAgentBasePath(agentName)}/jsonrpc`;
}

export function a2aRestUrl(publicBase: string, agentName: string): string {
  return `${publicBase}${a2aAgentBasePath(agentName)}/rest`;
}

export function a2aAgentCardUrl(publicBase: string, agentName: string): string {
  return `${publicBase}${a2aAgentBasePath(agentName)}/.well-known/agent-card.json`;
}
