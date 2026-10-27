import type { ToolApprovalEntry, ToolApprovalQueue } from '@zhin.js/agent/security';
import {
  definePluginConsoleRpc,
  generationAdmissionSource,
  PluginConsoleRpcError,
  type PluginConsoleRpc,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
} from '@zhin.js/plugin-runtime';

/**
 * Console approval cards for the dangerous-tool hard gate (ADR 0036 §3, slice E).
 *
 * Served as `plugin.root.tool-approvals` (read) and `plugin.root.resolve-tool-approval` (action).
 * Both declare their own permission, so only admin tokens or tokens granted
 * `tool_approvals:read` / `tool_approvals:resolve` can see or settle a card. The Agent owns the
 * queue for its generation; the newest installed Agent binds it here.
 */

export const TOOL_APPROVALS_READ_PERMISSION = 'tool_approvals:read';
export const TOOL_APPROVALS_RESOLVE_PERMISSION = 'tool_approvals:resolve';
/** Recorded as the deciding operator: the Console RPC call does not carry a per-user identity yet. */
export const CONSOLE_TOOL_APPROVAL_OPERATOR = 'console';

const RECENT_LIMIT = 50;

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
}

export class HostToolApprovals {
  #queue: ToolApprovalQueue | undefined;

  readonly consoleRpc: PluginConsoleRpc = definePluginConsoleRpc({
    queries: {
      'tool-approvals': {
        requiredPermissions: [TOOL_APPROVALS_READ_PERMISSION],
        handler: () => this.snapshot() as unknown as PluginConsoleRpcJson,
      },
    },
    actions: {
      'resolve-tool-approval': {
        requiredPermissions: [TOOL_APPROVALS_RESOLVE_PERMISSION],
        handler: (input) => this.resolve(input) as unknown as PluginConsoleRpcJson,
      },
    },
  });

  /** Binds the current Agent's queue; returns an unbind that only clears this binding. */
  bind(queue: ToolApprovalQueue): () => void {
    this.#queue = queue;
    return () => {
      if (this.#queue === queue) this.#queue = undefined;
    };
  }

  snapshot(): { readonly available: boolean; readonly pending: readonly ToolApprovalCard[]; readonly recent: readonly ToolApprovalCard[] } {
    const entries = this.#queue?.list() ?? [];
    return {
      available: this.#queue !== undefined,
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
    const queue = this.#queue;
    if (!queue) throw new PluginConsoleRpcError('unavailable', 'The Agent is not running');
    const current = queue.get(id);
    if (!current) throw new PluginConsoleRpcError('not_found', 'Approval card not found');
    const settled = queue.resolve(id, decision === 'approve', CONSOLE_TOOL_APPROVAL_OPERATOR);
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
  };
}
