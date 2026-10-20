/**
 * MCP qualified tool names — Eve-style `{connection}__{tool}` (ADR 0039 P1).
 */

const QUALIFIED_SEP = '__';

export function formatMcpQualifiedToolName(connectionName: string, toolName: string): string {
  const conn = connectionName.trim();
  const tool = toolName.trim();
  if (!conn || !tool) {
    throw new Error('formatMcpQualifiedToolName requires non-empty connection and tool names');
  }
  return `${conn}${QUALIFIED_SEP}${tool}`;
}

export function parseMcpQualifiedToolName(
  qualifiedName: string,
): { connection: string; tool: string } | null {
  const idx = qualifiedName.indexOf(QUALIFIED_SEP);
  if (idx <= 0 || idx >= qualifiedName.length - QUALIFIED_SEP.length) return null;
  return {
    connection: qualifiedName.slice(0, idx),
    tool: qualifiedName.slice(idx + QUALIFIED_SEP.length),
  };
}

export function isMcpQualifiedToolName(name: string): boolean {
  return parseMcpQualifiedToolName(name) != null;
}

/** Legacy `mcp_{server}_{tool}` — kept for catalog / migration hints only. */
export function parseLegacyMcpToolName(
  name: string,
): { connection: string; tool: string } | null {
  const match = /^mcp_([^_]+)_(.+)$/.exec(name);
  if (!match) return null;
  return { connection: match[1]!, tool: match[2]! };
}

export function resolveMcpConnectionFromToolName(
  name: string,
  source?: string,
): string | undefined {
  const srcMatch = /^mcp:([^:]+)/.exec(source ?? '');
  if (srcMatch) return srcMatch[1];
  return parseMcpQualifiedToolName(name)?.connection
    ?? parseLegacyMcpToolName(name)?.connection;
}
