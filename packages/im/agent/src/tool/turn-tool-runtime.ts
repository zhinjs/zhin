import { runTurnToolPolicies } from '../security/policy-facade.js';
import type { ToolCapability } from '../plugin-runtime/capability-ingress.js';
import { toolInvocationFromTurn } from '../plugin-runtime/capability-tools.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import {
  formatApprovalDenial,
  isApprovalPortAvailable,
  requestApprovalOutcome,
} from '../session/approval-port.js';
import type { AgentTool, ToolExecutionCause } from '@zhin.js/ai';
import type { ToolExecutionAuthority } from '../core/tool-execution-authority.js';
import { TurnJournalCommitError } from '../turn/journal-integrity.js';
import { NetworkAccessDeniedError } from '../security/network-policy.js';
import {
  PROVENANCE_POLICY,
  PROVENANCE_UNATTENDED_REASON,
  TurnProvenance,
  classifyHighRiskAction,
  formatProvenanceReason,
  isExternalContentSource,
  resolveInjectionGuard,
  type InjectionGuardSettings,
} from '../security/provenance.js';
import type { OutboundLeakInspector } from '../security/outbound-leak-guard.js';
import { resolveTurnTrustLevel } from '../security/trust-level.js';
import { safeSessionKey } from '../memory-layers.js';

type ToolJournalEvent = Extract<import('../event/turn-event.js').TurnEvent, {
  type: 'tool_call' | 'tool_result' | 'tool_denied' | 'tool_failed' | 'tool_cancelled';
}>;

export type TurnToolOutcome =
  | Readonly<{ status: 'completed'; output: unknown; durationMs: number }>
  | Readonly<{ status: 'denied'; policy: string; reason: string }>
  | Readonly<{ status: 'cancelled'; reason: string }>
  | Readonly<{ status: 'failed'; error: string; retryable: boolean }>;

export interface TurnToolRuntimeOptions {
  /** `ai.agent.injectionGuard`; unset keys use the conservative defaults. */
  readonly injectionGuard?: Partial<InjectionGuardSettings>;
  /** Shared with the engine so sources outside tool calls (background events) also count. */
  readonly provenance?: TurnProvenance;
  /** Masks leaks in the text arguments of outbound tools and learns other-session memory reads. */
  readonly leakInspector?: OutboundLeakInspector;
}

/** Sole execution authority for Tool capabilities within one fixed Turn lease. */
export class TurnToolRuntime {
  readonly #tools: ReadonlyMap<string, ToolCapability>;
  readonly #guard: InjectionGuardSettings;
  readonly #leakInspector?: OutboundLeakInspector;
  /** Lower-trust sources that reached the model during this turn (#727). */
  readonly provenance: TurnProvenance;

  constructor(
    private readonly turn: TurnIngress,
    tools: readonly ToolCapability[],
    options: TurnToolRuntimeOptions = {},
  ) {
    this.#tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.#guard = resolveInjectionGuard(options.injectionGuard);
    this.provenance = options.provenance ?? new TurnProvenance();
    this.#leakInspector = this.#guard.outboundCheck === 'redact' ? options.leakInspector : undefined;
  }

  async execute(
    name: string,
    input: Readonly<Record<string, unknown>>,
    toolUseId: string,
    cause?: ToolExecutionCause,
  ): Promise<TurnToolOutcome> {
    const tool = this.#tools.get(name);
    const causedBy = freezeToolExecutionCause(cause);
    if (!tool) return this.#deny(name, toolUseId, 'capability', `Unknown Tool capability: ${name}`, causedBy);
    await this.#append({ type: 'tool_call', toolName: name, args: { ...input }, toolUseId }, causedBy);
    if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
    const decision = await runTurnToolPolicies({ turn: this.turn, tool, input });
    // File/cwd authorization is asynchronous: cancellation can arrive after
    // the ingress check but before an allowed decision reaches execution.
    if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
    if (decision.status === 'denied') {
      return this.#deny(name, toolUseId, decision.policy, decision.reason, causedBy);
    }
    let effectiveInput = decision.input;
    const highRisk = classifyHighRiskAction(tool);
    const provenanceGate = highRisk !== undefined
      && this.#guard.confirmHighRisk === 'external_content'
      && this.provenance.tainted;
    if (provenanceGate) {
      // #727 M3.3: a high-risk action after lower-trust content always asks
      // first, even when the configured policy would allow it outright.
      if (this.turn.policy.unattended || !isApprovalPortAvailable(this.turn.ports.approval)) {
        return this.#deny(name, toolUseId, PROVENANCE_POLICY, PROVENANCE_UNATTENDED_REASON, causedBy);
      }
      const chain = this.provenance.describeChain(resolveTurnTrustLevel(this.turn), name);
      const approval = await requestApprovalOutcome(this.turn.ports.approval, {
        ...(tool.requiresApproval === 'human' ? { humanOnly: true } : {}),
        requestId: `${this.turn.identity.turnId}:${toolUseId}`,
        sessionKey: this.turn.session.key,
        ...(this.turn.origin.kind === 'im'
          ? { conversationScope: this.turn.origin.scope }
          : {}),
        requesterId: this.turn.principal.subjectId,
        toolName: name,
        // Never matches a remembered approval: each tainted call is confirmed on its own.
        scopeKey: `${PROVENANCE_POLICY}:${this.turn.identity.turnId}:${toolUseId}`,
        question: formatApprovalQuestion(name, formatProvenanceReason(highRisk, chain), effectiveInput),
        signal: this.turn.signal,
      });
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
      if (approval.status !== 'approved') {
        return this.#deny(name, toolUseId, PROVENANCE_POLICY, formatApprovalDenial(approval), causedBy);
      }
    } else if (decision.status === 'approval_required') {
      if (this.turn.policy.unattended || !isApprovalPortAvailable(this.turn.ports.approval)) {
        return this.#deny(name, toolUseId, decision.policy, 'approval required but ApprovalPort unavailable', causedBy);
      }
      const approval = await requestApprovalOutcome(this.turn.ports.approval, {
        ...(tool.requiresApproval === 'human' ? { humanOnly: true } : {}),
        requestId: `${this.turn.identity.turnId}:${toolUseId}`,
        sessionKey: this.turn.session.key,
        ...(this.turn.origin.kind === 'im'
          ? { conversationScope: this.turn.origin.scope }
          : {}),
        requesterId: this.turn.principal.subjectId,
        toolName: name,
        scopeKey: tool.requiresApproval === 'once'
          ? name
          : approvalScopeKey(name, decision.input),
        ...(tool.requiresApproval === 'once' || decision.policy === 'exec-policy'
          ? { remember: 'session' as const }
          : {}),
        question: formatApprovalQuestion(name, decision.reason, decision.input),
        signal: this.turn.signal,
      });
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
      if (approval.status !== 'approved') {
        return this.#deny(name, toolUseId, decision.policy, formatApprovalDenial(approval), causedBy);
      }
    }

    if (highRisk === 'outbound' && this.#leakInspector) {
      // #727 M3.4: messages to other conversations go through the same leak check as replies.
      effectiveInput = this.#leakInspector.inspectArguments(effectiveInput).input;
    }

    const startedAt = Date.now();
    try {
      const output = await tool.execute(effectiveInput, toolInvocationFromTurn(this.turn));
      this.#observeOutput(tool, effectiveInput, output);
      const durationMs = Date.now() - startedAt;
      // A tool that ignores cancellation may already have committed side effects.
      // Record its real settlement so the audit trail never invites an unsafe retry.
      await this.#append({ type: 'tool_result', toolName: name, output, durationMs, toolUseId }, causedBy);
      if (this.turn.signal.aborted) return this.#cancelledOutcome();
      return Object.freeze({ status: 'completed', output, durationMs });
    } catch (error) {
      if (error instanceof TurnJournalCommitError) throw error;
      const durationMs = Date.now() - startedAt;
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, durationMs, causedBy);
      if (error instanceof NetworkAccessDeniedError) {
        return this.#deny(name, toolUseId, error.policy, error.message, causedBy);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.#append({ type: 'tool_failed', toolName: name, toolUseId, error: message, durationMs }, causedBy);
      return Object.freeze({ status: 'failed', error: message, retryable: false });
    }
  }

  /** Records where the result came from, and which parts are another session's memory. */
  #observeOutput(tool: ToolCapability, input: Readonly<Record<string, unknown>>, output: unknown): void {
    if (isExternalContentSource(tool, this.#guard)) {
      this.provenance.record(tool.name === 'spawn_task'
        ? { kind: 'subagent_report' }
        : { kind: 'tool_result', toolName: tool.name });
    }
    if (this.#leakInspector && readsOtherSessionMemory(input, this.turn.session.key)) {
      this.#leakInspector.protectOtherSessionMemory(collectText(output));
    }
  }

  async #deny(toolName: string, toolUseId: string, policy: string, reason: string, causedBy?: ToolExecutionCause): Promise<TurnToolOutcome> {
    await this.#append({ type: 'tool_denied', toolName, toolUseId, policy, reason }, causedBy);
    return Object.freeze({ status: 'denied', policy, reason });
  }

  async #cancel(toolName: string, toolUseId: string, durationMs: number, causedBy?: ToolExecutionCause): Promise<TurnToolOutcome> {
    const outcome = this.#cancelledOutcome();
    await this.#append({ type: 'tool_cancelled', toolName, toolUseId, reason: outcome.reason, durationMs }, causedBy);
    return outcome;
  }

  #cancelledOutcome(): Extract<TurnToolOutcome, { status: 'cancelled' }> {
    const reason = this.turn.signal.reason instanceof Error
      ? this.turn.signal.reason.message
      : String(this.turn.signal.reason ?? 'turn cancelled');
    return Object.freeze({ status: 'cancelled', reason });
  }

  async #append(event: ToolJournalEvent, causedBy?: ToolExecutionCause): Promise<void> {
    try {
      await this.turn.ports.journal.append(causedBy ? { ...event, causedBy } : event);
    } catch (error) {
      throw new TurnJournalCommitError(error);
    }
  }
}

function formatApprovalQuestion(
  toolName: string,
  reason: string,
  input: Readonly<Record<string, unknown>>,
): string {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
  const path = ['file_path', 'path'].map((key) => input[key]).find((value) => typeof value === 'string') as string | undefined;
  return [
    `工具「${toolName}」需要确认后执行。`,
    command ? `命令：${command}` : undefined,
    cwd ? `工作目录：${cwd}` : undefined,
    path ? `目标文件：${path}` : undefined,
    `风险：${reason}`,
    '是否继续？',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

const SESSION_MEMORY_PATH = /(?:^|[\\/])data[\\/]memory[\\/]sessions[\\/]([^\\/]+)/;

/** True when a file tool's path points into a different session's memory directory. */
function readsOtherSessionMemory(input: Readonly<Record<string, unknown>>, sessionKey: string): boolean {
  const path = ['file_path', 'path', 'filePath'].map((key) => input[key]).find((value) => typeof value === 'string') as string | undefined;
  const match = path ? SESSION_MEMORY_PATH.exec(path) : null;
  return match !== null && match[1] !== safeSessionKey(sessionKey);
}

/** Every string inside a tool output, one per line (file tools may return structured results). */
function collectText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (depth > 4 || value === null || typeof value !== 'object') return '';
  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return entries.map((entry) => collectText(entry, depth + 1)).filter(Boolean).join('\n');
}

function approvalScopeKey(toolName: string, input: Readonly<Record<string, unknown>>): string {
  return `${toolName}:${stableApprovalValue(input)}`;
}

function stableApprovalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableApprovalValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableApprovalValue(entry)}`)
      .join(',')}}`;
  }
  if (typeof value === 'undefined') return 'undefined';
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Adapts canonical capability execution to the full AgentCore seam. */
export class TurnToolExecutionAuthority implements ToolExecutionAuthority {
  readonly #runtime: TurnToolRuntime;

  constructor(runtime: TurnToolRuntime) {
    this.#runtime = runtime;
  }

  execute(
    tool: AgentTool,
    input: Readonly<Record<string, unknown>>,
    toolUseId: string,
    cause?: ToolExecutionCause,
  ) {
    return this.#runtime.execute(tool.name, input, toolUseId, cause);
  }
}

function freezeToolExecutionCause(cause?: ToolExecutionCause): ToolExecutionCause | undefined {
  if (!cause?.principal && !cause?.turn) return undefined;
  return Object.freeze({
    ...(cause.principal ? {
      principal: Object.freeze({
        ...cause.principal,
        ...(cause.principal.roles ? { roles: Object.freeze([...cause.principal.roles]) } : {}),
      }),
    } : {}),
    ...(cause.turn ? { turn: Object.freeze({ ...cause.turn }) } : {}),
  });
}
