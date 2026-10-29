import type { SelfChangeApprovals, SelfChangeRecord, SelfChangeStore } from '@zhin.js/agent';
import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type PluginConsoleRpc,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
} from '@zhin.js/plugin-runtime';
import {
  CONSOLE_TOOL_APPROVAL_OPERATOR,
  OPS_APPROVE_PERMISSION,
  TOOL_APPROVALS_READ_PERMISSION,
} from './tool-approvals.js';

/**
 * Console surface for controlled self-change (ADR 0040 §4 / §6a, slice D).
 *
 * - `plugin.root.self-changes` (read: `tool_approvals:read` or `ops:approve`): pending changes with their
 *   preview and trial verdict, recent changes, and the staging-area usage. Never returns file bodies.
 * - `plugin.root.resolve-self-change` (`ops:approve`): approve / reject a pending change. It settles the same
 *   G6 approval card the IM channel uses, so whichever answers first wins.
 * - `plugin.root.mark-self-change-handled` (`ops:approve`): a person has dealt with a `failed` (emergency-stopped)
 *   change; its kept files are removed and its retention starts (§6a).
 * The newest installed Agent generation binds its store and approvals here.
 */

const RECENT_LIMIT = 50;

export interface SelfChangeCard {
  readonly id: string;
  readonly status: SelfChangeRecord['status'];
  readonly contentHash: string;
  readonly files: PluginConsoleRpcJson;
  readonly configPaths: readonly string[];
  readonly preview: PluginConsoleRpcJson;
  readonly trial: PluginConsoleRpcJson;
  readonly origin: PluginConsoleRpcJson;
  readonly approvalId: string | null;
  readonly approvedBy: string | null;
  readonly error: string | null;
  readonly bytes: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly submittedAt: number | null;
  readonly terminalAt: number | null;
  readonly resolvedAt: number | null;
  readonly slimmed: boolean;
}

interface Binding {
  readonly store: SelfChangeStore;
  readonly approvals: SelfChangeApprovals;
}

export class HostSelfChanges {
  #binding: Binding | undefined;

  readonly consoleRpc: PluginConsoleRpc = definePluginConsoleRpc({
    queries: {
      'self-changes': {
        anyOfPermissions: [TOOL_APPROVALS_READ_PERMISSION, OPS_APPROVE_PERMISSION],
        handler: async () => (await this.snapshot()) as unknown as PluginConsoleRpcJson,
      },
    },
    actions: {
      'resolve-self-change': {
        anyOfPermissions: [OPS_APPROVE_PERMISSION],
        handler: async (input) => (await this.resolve(input)) as unknown as PluginConsoleRpcJson,
      },
      'mark-self-change-handled': {
        anyOfPermissions: [OPS_APPROVE_PERMISSION],
        handler: async (input) => (await this.markHandled(input)) as unknown as PluginConsoleRpcJson,
      },
    },
  });

  /** Binds the current generation; returns an unbind that only clears this binding. */
  bind(store: SelfChangeStore, approvals: SelfChangeApprovals): () => void {
    const binding = { store, approvals };
    this.#binding = binding;
    return () => {
      if (this.#binding === binding) this.#binding = undefined;
    };
  }

  async snapshot(): Promise<{
    readonly available: boolean;
    readonly pending: readonly SelfChangeCard[];
    readonly recent: readonly SelfChangeCard[];
    readonly usageBytes: number;
  }> {
    const binding = this.#binding;
    if (!binding) return { available: false, pending: [], recent: [], usageBytes: 0 };
    const records = await binding.store.list();
    const toCard = (record: SelfChangeRecord) => card(record, binding.approvals.approvalIdFor(record.id) ?? null);
    return {
      available: true,
      pending: records.filter(record => record.status === 'pending').map(toCard),
      recent: records.filter(record => record.status !== 'pending').slice(0, RECENT_LIMIT).map(toCard),
      usageBytes: await binding.store.usage(),
    };
  }

  async resolve(input: PluginConsoleRpcInput): Promise<SelfChangeCard> {
    const id = requireId(input);
    const decision = input.decision;
    if (decision !== 'approve' && decision !== 'reject') {
      throw new PluginConsoleRpcError('invalid_input', 'id and decision (approve | reject) are required');
    }
    const binding = this.#requireBinding();
    try {
      const record = await binding.approvals.decide(id, decision === 'approve', CONSOLE_TOOL_APPROVAL_OPERATOR, 'console');
      return card(record, null);
    } catch (error) {
      throw consoleError(error);
    }
  }

  async markHandled(input: PluginConsoleRpcInput): Promise<SelfChangeCard> {
    const id = requireId(input);
    const binding = this.#requireBinding();
    try {
      return card(await binding.store.markFailedHandled(id, CONSOLE_TOOL_APPROVAL_OPERATOR), null);
    } catch (error) {
      throw consoleError(error);
    }
  }

  #requireBinding(): Binding {
    const binding = this.#binding;
    if (!binding) throw new PluginConsoleRpcError('unavailable', 'The Agent is not running');
    return binding;
  }
}

function requireId(input: PluginConsoleRpcInput): string {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id) throw new PluginConsoleRpcError('invalid_input', 'id is required');
  return id;
}

function consoleError(error: unknown): unknown {
  // @zhin.js/agent is an optional peer; never import it at module load. Match by error.name.
  if (isNamedError(error, 'SelfChangeNotFoundError')) {
    return new PluginConsoleRpcError('not_found', 'Change not found');
  }
  if (isNamedError(error, 'SelfChangeStateError')) {
    const status = typeof (error as { status?: unknown }).status === 'string'
      ? (error as { status: string }).status
      : 'unknown';
    return new PluginConsoleRpcError('conflict', `Change is ${status}`);
  }
  return error;
}

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}

function card(record: SelfChangeRecord, approvalId: string | null): SelfChangeCard {
  return {
    id: record.id,
    status: record.status,
    contentHash: record.contentHash,
    files: record.files as unknown as PluginConsoleRpcJson,
    configPaths: record.configPatch?.patches.map(patch => `${patch.op} ${patch.path.join('.')}`) ?? [],
    preview: (record.plan ?? null) as PluginConsoleRpcJson,
    trial: (record.trial ?? null) as PluginConsoleRpcJson,
    origin: record.origin as unknown as PluginConsoleRpcJson,
    approvalId,
    approvedBy: record.approvedBy,
    error: record.error,
    bytes: record.bytes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
    terminalAt: record.terminalAt,
    resolvedAt: record.resolvedAt,
    slimmed: record.slimmed,
  };
}
