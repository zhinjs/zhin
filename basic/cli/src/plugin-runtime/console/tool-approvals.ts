import type { ToolApprovalEntry, ToolApprovalQueue } from '@zhin.js/agent/security';
import {
  definePluginConsoleRpc,
  generationAdmissionSource,
  PluginConsoleRpcError,
  type PluginConsoleRpc,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
  type SnapshotReader,
  type SnapshotLease,
} from '@zhin.js/plugin-runtime';
import { agentToolApprovalQueueToken } from './tool-approval-resource.js';

/**
 * Console approval cards for the dangerous-tool hard gate (ADR 0036 §3, slice E).
 *
 * Served as `plugin.root.tool-approvals` (read) and `plugin.root.resolve-tool-approval` (action).
 * Both declare their own permission, so only admin tokens or tokens granted the permission can see
 * or settle a card:
 * - read: `tool_approvals:read` **or** `ops:approve`;
 * - settle: `ops:approve` (ADR 0037 §3, slice E: the approver permission, shared with announcement
 *   approval) **or** the older `tool_approvals:resolve`, kept for backward compatibility so existing
 *   tokens keep working. Either one is enough (`anyOfPermissions`); the full token passes as before.
 * The dispatcher constructs this facade from its already leased Agent Root.
 */

export const TOOL_APPROVALS_READ_PERMISSION = 'tool_approvals:read';
export const TOOL_APPROVALS_RESOLVE_PERMISSION = 'tool_approvals:resolve';
/**
 * Console approver permission (ADR 0037 §3, slice E): settles hard-gate approval cards and approves /
 * rejects / resends announcements. Separate from `control:write`.
 */
export const OPS_APPROVE_PERMISSION = 'ops:approve';
/** Recorded as the deciding operator: the Console RPC call does not carry a per-user identity yet. */
export const CONSOLE_TOOL_APPROVAL_OPERATOR = 'console';

const RECENT_LIMIT = 50;

/** Trusted composition input; the caller already owns this exact request lease. */
export interface HostToolApprovalRpcInput {
  readonly snapshots: Pick<SnapshotReader, 'rootResource'>;
  readonly lease: SnapshotLease;
}

export function createHostToolApprovalConsoleRpc(input: HostToolApprovalRpcInput): PluginConsoleRpc {
  if (!input.snapshots.rootResource) throw new PluginConsoleRpcError('unavailable', 'Root resource resolution is unavailable');
  return new HostToolApprovals(input.snapshots.rootResource(input.lease, agentToolApprovalQueueToken)).consoleRpc;
}

export interface ToolApprovalCard {
  readonly id: string;
  readonly toolName: string;
  readonly category: string | null;
  readonly sessionKey: string;
  readonly requesterId: string | null;
  readonly args: PluginConsoleRpcJson;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: ToolApprovalEntry['status'];
  readonly decidedAt: number | null;
  readonly decidedBy: string | null;
  /** Channel that settled the card: `console`, `im_dm`, `im_approver_group`, or null (timeout / in-turn prompt). */
  readonly channel: ToolApprovalEntry['channel'];
}

export class HostToolApprovals {
  constructor(private readonly queue?: ToolApprovalQueue) {}

  readonly consoleRpc: PluginConsoleRpc = definePluginConsoleRpc({
    queries: {
      'tool-approvals': {
        anyOfPermissions: [TOOL_APPROVALS_READ_PERMISSION, OPS_APPROVE_PERMISSION],
        handler: () => this.snapshot() as unknown as PluginConsoleRpcJson,
      },
    },
    actions: {
      'resolve-tool-approval': {
        anyOfPermissions: [OPS_APPROVE_PERMISSION, TOOL_APPROVALS_RESOLVE_PERMISSION],
        handler: (input) => this.resolve(input) as unknown as PluginConsoleRpcJson,
      },
    },
  });

  snapshot(): { readonly available: boolean; readonly pending: readonly ToolApprovalCard[]; readonly recent: readonly ToolApprovalCard[] } {
    const entries = this.queue?.list() ?? [];
    return {
      available: this.queue !== undefined,
      pending: entries.filter((entry) => entry.status === 'pending').map(toCard),
      recent: entries.filter((entry) => entry.status !== 'pending').slice(0, RECENT_LIMIT).map(toCard),
    };
  }

  resolve(input: PluginConsoleRpcInput): ToolApprovalCard {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    const decision = input.decision;
    if (!id || (decision !== 'approve' && decision !== 'deny')) {
      throw new PluginConsoleRpcError('invalid_input', 'id and decision (approve | deny) are required');
    }
    const queue = this.queue;
    if (!queue) throw new PluginConsoleRpcError('unavailable', 'The Agent is not running');
    const current = queue.get(id);
    if (!current) throw new PluginConsoleRpcError('not_found', 'Approval card not found');
    const settled = queue.resolve(id, decision === 'approve', CONSOLE_TOOL_APPROVAL_OPERATOR, { channel: 'console' });
    if (!settled) throw new PluginConsoleRpcError('conflict', `Approval card is already ${current.status}`);
    return toCard(settled);
  }
}

/** Merges Host-owned Console RPC surfaces into the single `plugin.root.*` namespace. */
export function composeHostConsoleRpc(...surfaces: readonly PluginConsoleRpc[]): PluginConsoleRpc {
  const methods = new Map<string, PluginConsoleRpc['methods'] extends ReadonlyMap<string, infer M> ? M : never>();
  for (const surface of surfaces) {
    for (const [name, method] of surface.methods) {
      if (methods.has(name)) throw new TypeError(`Duplicate Host Console RPC method: ${name}`);
      methods.set(name, method);
    }
  }
  const gates = Object.freeze(surfaces.flatMap((surface) => [...surface[generationAdmissionSource]]));
  return Object.freeze({
    methods,
    get [generationAdmissionSource]() { return gates; },
  });
}

function toCard(entry: ToolApprovalEntry): ToolApprovalCard {
  return {
    id: entry.id,
    toolName: entry.toolName,
    category: entry.category,
    sessionKey: entry.sessionKey,
    requesterId: entry.requesterId,
    args: entry.args as PluginConsoleRpcJson,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    status: entry.status,
    decidedAt: entry.decidedAt,
    decidedBy: entry.decidedBy,
    channel: entry.channel,
  };
}
