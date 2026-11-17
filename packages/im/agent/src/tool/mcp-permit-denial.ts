/** `TurnToolOutcome.denied.policy` / `tool_denied.policy` when a chat role may not use an MCP tool (ADR 0065 D4.3). */
export const MCP_PERMIT_POLICY = 'mcp-permit';

/** Plain-language reason for an MCP tool the sender's chat role may not use. */
export function formatMcpPermitDenial(permissions: readonly string[] | undefined): string {
  if (permissions?.length === 1 && permissions[0] === 'owner@global') return '这个 MCP 工具只对主人开放。';
  return '你当前的聊天角色不能使用这个 MCP 工具。';
}

/** Thrown by an MCP tool's `execute` when the sender's current role no longer passes its permit. */
export class McpPermitDeniedError extends Error {
  readonly policy = MCP_PERMIT_POLICY;

  constructor(readonly toolName: string, permissions: readonly string[] | undefined) {
    super(formatMcpPermitDenial(permissions));
    this.name = 'McpPermitDeniedError';
  }
}
