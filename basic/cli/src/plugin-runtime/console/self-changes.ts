import type {
  DecisionPayload,
  SelfChangeApprovals,
  SelfChangeConfigOperation,
  SelfChangeDetailDiff,
  SelfChangeRecord,
  SelfChangeStore,
} from '@zhin.js/agent';
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
 * - `plugin.root.self-change-detail` (`ops:approve` only, #1142 F3): one change with a unified diff per file
 *   (baseline: rollback snapshot once applying started, otherwise the production file; total ≤ 64 KB, cut by line
 *   with `truncated`), the config patch with values redacted like decision audit payloads, and the full trial
 *   checks including the skipped ones. A slimmed change reports `bodiesAvailable: false` instead of a diff.
 * - `plugin.root.resolve-self-change` (`ops:approve`): approve / reject a pending change. It settles the same
 *   G6 approval card the IM channel uses, so whichever answers first wins.
 * - `plugin.root.mark-self-change-handled` (`ops:approve`): a person has dealt with a `failed` (emergency-stopped)
 *   change; its kept files are removed and its retention starts (§6a).
 * The newest installed Agent generation binds its store and approvals here.
 */

const RECENT_LIMIT = 50;

export interface SelfChangeDetailFile {
  readonly path: string;
  readonly kind: 'create' | 'modify' | 'delete';
  /** Unified diff; empty string = identical to the baseline; null = not available (see `unavailableReason`). */
  readonly diff: string | null;
  readonly truncated: boolean;
  readonly unavailableReason: string | null;
}

export interface SelfChangeDetailConfigOperation {
  readonly op: SelfChangeConfigOperation['op'];
  readonly path: readonly string[];
  /** Redacted value (`set` only). */
  readonly value?: PluginConsoleRpcJson;
}

export interface SelfChangeDetailTrial {
  readonly passed: boolean | null;
  /** Every check, each redacted on its own (no list cap). */
  readonly checks: PluginConsoleRpcJson;
  readonly pendingStages: readonly string[];
  /** `<check> <path>` of every skipped check. */
  readonly skippedChecks: readonly string[];
}

export interface SelfChangeDetail {
  readonly change: SelfChangeCard;
  /** False once the change is slimmed: staged bodies are gone and no diff is returned. */
  readonly bodiesAvailable: boolean;
  readonly baseline: 'disk' | 'snapshot';
  readonly files: readonly SelfChangeDetailFile[];
  readonly diffBytes: number;
  readonly maxDiffBytes: number;
  readonly diffTruncated: boolean;
  readonly configPatch: Readonly<{ expectedRevision: string; operations: readonly SelfChangeDetailConfigOperation[] }> | null;
  readonly trial: SelfChangeDetailTrial | null;
  readonly usageBytes: number;
}

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
      'self-change-detail': {
        // File bodies and config values: approvers only, never the read-only list permission.
        anyOfPermissions: [OPS_APPROVE_PERMISSION],
        handler: async (input) => (await this.detail(input)) as unknown as PluginConsoleRpcJson,
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

  async detail(input: PluginConsoleRpcInput): Promise<SelfChangeDetail> {
    const id = requireId(input);
    const binding = this.#requireBinding();
    let record: SelfChangeRecord | null;
    try {
      record = await binding.store.get(id);
    } catch (error) {
      throw consoleError(error);
    }
    if (!record) throw new PluginConsoleRpcError('not_found', 'Change not found');
    // @zhin.js/agent is an optional peer: load its helpers only when a change is actually inspected.
    const agent = await import('@zhin.js/agent');
    let diff: SelfChangeDetailDiff;
    try {
      diff = await agent.buildSelfChangeDetailDiff({ store: binding.store, record, projectRoot: binding.store.projectRoot });
    } catch (error) {
      throw consoleError(error);
    }
    const redact = agent.redactDecisionPayload;
    const trial = detailTrial(record.trial, agent.skippedTrialChecks, redact);
    return {
      // The card's own `trial` would be a second, unredacted copy: carry the sanitized one instead.
      change: { ...card(record, binding.approvals.approvalIdFor(record.id) ?? null), trial: trial as unknown as PluginConsoleRpcJson },
      bodiesAvailable: diff.bodiesAvailable,
      baseline: diff.baseline,
      files: diff.files.map(file => ({
        path: file.path,
        kind: file.kind,
        diff: file.diff,
        truncated: file.truncated,
        unavailableReason: file.unavailableReason,
      })),
      diffBytes: diff.bytes,
      maxDiffBytes: agent.MAX_CHANGE_PREVIEW_BYTES,
      diffTruncated: diff.truncated,
      configPatch: record.configPatch
        ? {
            expectedRevision: record.configPatch.expectedRevision,
            operations: record.configPatch.patches.map(operation => redactConfigOperation(operation, redact, agent.isSecretPayloadKey)),
          }
        : null,
      trial,
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
    const status = readStringProp(error, 'status') ?? 'unknown';
    return new PluginConsoleRpcError('conflict', `Change is ${status}`);
  }
  return error;
}

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}

function readStringProp(error: unknown, key: string): string | undefined {
  if (!error || typeof error !== 'object' || !(key in error)) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

type RedactPayload = (payload: DecisionPayload | null | undefined) => DecisionPayload;

/**
 * Redacts a `set` value with the decision-audit rules: a secret-like key anywhere on the config path (`token`,
 * `apiKey`, `auth`, …) replaces the whole value; otherwise the value itself is redacted (secret keys inside it,
 * token-shaped strings). The path is checked on its own so deep config paths do not eat the depth limit.
 */
function redactConfigOperation(
  operation: SelfChangeConfigOperation,
  redact: RedactPayload,
  isSecretKey: (key: string) => boolean,
): SelfChangeDetailConfigOperation {
  const configPath = [...operation.path];
  if (operation.op === 'remove') return { op: 'remove', path: configPath };
  if (configPath.some(isSecretKey)) return { op: 'set', path: configPath, value: '[redacted]' };
  const redacted = redact({ value: operation.value }).value;
  return { op: 'set', path: configPath, value: (redacted ?? null) as PluginConsoleRpcJson };
}

function detailTrial(
  trial: unknown,
  skippedTrialChecks: (trial: unknown) => readonly string[],
  redact: RedactPayload,
): SelfChangeDetailTrial | null {
  if (!trial || typeof trial !== 'object') return null;
  const value = trial as { passed?: unknown; checks?: unknown; pendingStages?: unknown };
  const checks = Array.isArray(value.checks) ? value.checks : [];
  const pendingStages = Array.isArray(value.pendingStages)
    ? value.pendingStages.filter((stage): stage is string => typeof stage === 'string')
    : [];
  return {
    passed: typeof value.passed === 'boolean' ? value.passed : null,
    // Check messages may quote file content or tool output: same masking as the audit trail, one check at a time
    // so the audit list cap never hides checks from the approver.
    checks: checks.map(check => redact({ check }).check ?? null) as PluginConsoleRpcJson,
    pendingStages,
    skippedChecks: [...skippedTrialChecks(trial)],
  };
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
