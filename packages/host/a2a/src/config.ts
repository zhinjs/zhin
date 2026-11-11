/** Per-agent A2A endpoint URLs used by Agent Card interfaces. */
function a2aAgentBasePath(agentName: string): string {
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
