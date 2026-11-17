/**
 * ADR 0065 D4: MCP tools go through the same `PermissionHost` gate as plugin tools — once when the
 * turn's tool pool is assembled, and again with the sender's current role before each call.
 */
import type { PermissionHost } from '@zhin.js/permission';
import type { FrozenCapabilityCatalog, TurnAccessContext } from '../turn/turn-ingress.js';
import { canAccessDescriptor, type ToolCapability } from './capability-ingress.js';
import { McpPermitDeniedError } from '../tool/mcp-permit-denial.js';

export { MCP_PERMIT_POLICY, McpPermitDeniedError, formatMcpPermitDenial } from '../tool/mcp-permit-denial.js';

export interface McpToolAccess {
  /** Tools the turn's sender may use; they enter the tool pool. */
  readonly visible: readonly ToolCapability[];
  /** Tools withheld from this turn; a call to one is denied with `mcp-permit`. */
  readonly withheld: readonly ToolCapability[];
}

/** Splits expanded MCP tools by the turn-start sender facts (`principal.chatRole` / `chatRoleLevels`). */
export async function filterMcpToolsForTurn(
  tools: readonly ToolCapability[],
  turn: TurnAccessContext,
  host: PermissionHost | undefined,
): Promise<McpToolAccess> {
  const access = await Promise.all(tools.map(async (tool) => ({ tool, allowed: await canAccessDescriptor(tool, turn, host) })));
  return Object.freeze({
    visible: Object.freeze(access.filter(({ allowed }) => allowed).map(({ tool }) => tool)),
    withheld: Object.freeze(access.filter(({ allowed }) => !allowed).map(({ tool }) => tool)),
  });
}

/**
 * Execution-time re-check with the sender's role re-read from the role store: a replayed call, a
 * role revoked mid-turn or a delegated turn that kept the parent's tools cannot run the tool.
 * Without a turn (static capability queries) there is no sender to check.
 */
export async function assertMcpToolStillPermitted(
  tool: Readonly<{ qualifiedName: string; permissions?: readonly string[] }>,
  turn: TurnAccessContext | undefined,
  host: PermissionHost | undefined,
): Promise<void> {
  if (!turn || !tool.permissions?.length) return;
  if (!(await canAccessDescriptor({ permissions: tool.permissions }, turn, host, true))) {
    throw new McpPermitDeniedError(tool.qualifiedName, tool.permissions);
  }
}

/** The withheld tools as recorded on the turn's frozen catalog (names → permits). */
export function withheldMcpToolCatalog(withheld: readonly ToolCapability[]): Pick<FrozenCapabilityCatalog, 'withheldMcpTools'> {
  if (!withheld.length) return {};
  return { withheldMcpTools: Object.fromEntries(withheld.map((tool) => [tool.name, [...(tool.permissions ?? [])]])) };
}
