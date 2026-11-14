import { runTurnToolPolicies } from '../security/policy-facade.js';
import type { ToolCapability } from '../plugin-runtime/capability-ingress.js';
import { approvalActionLabel } from './approval-presentation.js';
import { toolInvocationFromTurn } from '../plugin-runtime/capability-tools.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import {
  formatApprovalBlocked,
  formatApprovalDenial,
  isApprovalPortAvailable,
  requestApprovalOutcome,
  type ApprovalBlockReason,
  type ApprovalDenialContext,
  type ApprovalOutcome,
} from '../session/approval-port.js';
import { redactApprovalDisplay, redactSecretText } from '../decision-events.js';
import { resolveMessageAliasArguments, UnconfirmedMessageAliasError, type AgentTool, type MessageAliasTable, type ToolExecutionCause } from '@zhin.js/ai';
import type { ToolExecutionAuthority } from '../core/tool-execution-authority.js';
import { TurnJournalCommitError } from '../turn/journal-integrity.js';
import { NetworkAccessDeniedError } from '../security/network-policy.js';
import {
  PROVENANCE_NO_CHANNEL_REASON,
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
import {
  TOOL_HARD_GATE_POLICY,
  ToolHardGate,
  type DecisionAuditSink,
  type ToolHardGateConfig,
  type ToolHardGateControlSource,
  type ToolHardGateLocation,
} from '../security/tool-hard-gate.js';
import type { ToolApprovalOrigin, ToolApprovalQueue } from '../security/tool-approval-queue.js';
import type { OpsCooldownView } from '../security/ops-cooldown.js';
import { ON_BEHALF_OF_ARG, resolveOnBehalfOf } from '../turn/merged-principal.js';

/** `TurnToolOutcome.denied.policy` for a merged-turn call that failed its `onBehalfOf` re-check. */
export const MERGE_ON_BEHALF_POLICY = 'merge-on-behalf';

type ToolJournalEvent = Extract<import('../event/turn-event.js').TurnEvent, {
  type: 'tool_call' | 'tool_result' | 'tool_denied' | 'tool_failed' | 'tool_cancelled';
}>;

export type TurnToolOutcome =
  | Readonly<{ status: 'completed'; output: unknown; durationMs: number }>
  | Readonly<{ status: 'denied'; policy: string; reason: string; sideEffect?: boolean }>
  | Readonly<{ status: 'cancelled'; reason: string }>
  | Readonly<{ status: 'failed'; error: string; retryable: boolean; sideEffect?: boolean }>;

export interface TurnToolRuntimeOptions {
  /** `ai.agent.injectionGuard`; unset keys use the conservative defaults. */
  readonly injectionGuard?: Partial<InjectionGuardSettings>;
  /** Shared with the engine so sources outside tool calls (background events) also count. */
  readonly provenance?: TurnProvenance;
  /** Masks leaks in the text arguments of outbound tools and learns other-session memory reads. */
  readonly leakInspector?: OutboundLeakInspector;
  /** `ai.agent.toolHardGate`; the hard gate itself is always on (ADR 0036). */
  readonly hardGate?: ToolHardGateConfig;
  /** Writes `tool_approval` / `tool_hard_gate` rows; failures never affect the decision. */
  readonly decisionAudit?: DecisionAuditSink;
  /** Console approval cards for dangerous calls; absent means IM approval only. */
  readonly approvalQueue?: ToolApprovalQueue;
  /** Control plane (#1008): emergency_stop / read_only deny dangerous tools before any approval prompt. */
  readonly controlPlane?: ToolHardGateControlSource;
  /** Group-ops cooldown (ADR 0037 §3, slice E): checked before a new approval card is created. */
  readonly opsCooldown?: OpsCooldownView;
  /** ADR 0043 §5: alias (`m12`) to platform id map the model's tool arguments are resolved through. */
  readonly messageAliases?: Pick<MessageAliasTable, 'resolve'>;
}

/** Sole execution authority for Tool capabilities within one fixed Turn lease. */
export class TurnToolRuntime {
  readonly #tools: ReadonlyMap<string, ToolCapability>;
  readonly #guard: InjectionGuardSettings;
  readonly #leakInspector?: OutboundLeakInspector;
  readonly #messageAliases?: Pick<MessageAliasTable, 'resolve'>;
  readonly #hardGate: ToolHardGate;
  readonly #decisionAudit?: DecisionAuditSink;
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
    this.#messageAliases = options.messageAliases;
    this.#decisionAudit = options.decisionAudit;
    this.#leakInspector = this.#guard.outboundCheck === 'redact' ? options.leakInspector : undefined;
    this.#hardGate = new ToolHardGate(options.hardGate, {
      turnId: turn.identity.turnId,
      sessionKey: turn.session.key,
      requesterId: turn.principal.subjectId,
      ...(turn.origin.kind === 'im' ? { conversationScope: turn.origin.scope } : {}),
      unattended: turn.policy.unattended,
      ...(turn.ports.approval ? { approval: turn.ports.approval } : {}),
      signal: turn.signal,
      location: hardGateLocation(turn),
      ...hardGateOrigin(turn),
      ...(turn.hostProtectedPaths ? { protectedPaths: turn.hostProtectedPaths } : {}),
      ...(options.decisionAudit ? { audit: options.decisionAudit } : {}),
      ...(options.approvalQueue ? { queue: options.approvalQueue } : {}),
      ...(options.controlPlane ? { controlPlane: options.controlPlane } : {}),
      ...(options.opsCooldown ? { opsCooldown: options.opsCooldown } : {}),
      // ADR 0038 §2: a merged turn asks for at most one approval card.
      ...(turn.policy.merge ? { maxCardsPerTurn: 1 } : {}),
    });
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
    // The journal keeps what the model wrote; policies and the tool see platform ids.
    if (this.#messageAliases) {
      try {
        input = resolveMessageAliasArguments(input, this.#messageAliases);
      } catch (error) {
        if (!(error instanceof UnconfirmedMessageAliasError)) throw error;
        await this.#append({ type: 'tool_failed', toolName: name, toolUseId, error: error.message, durationMs: 0 }, causedBy);
        return Object.freeze({ status: 'failed', error: error.message, retryable: false, sideEffect: tool.readOnly !== true });
      }
    }
    let actingFor: string | undefined;
    const merge = this.turn.policy.merge;
    if (merge) {
      // ADR 0038 §2: every side-effect call of a merged turn acts for one sender and is
      // re-checked against that sender's own Tools; `onBehalfOf` never reaches the Tool.
      const { [ON_BEHALF_OF_ARG]: onBehalfOf, ...rest } = input;
      input = rest;
      if (classifyHighRiskAction(tool) !== undefined || this.#hardGate.assess(tool, input).risk === 'dangerous') {
        const resolution = resolveOnBehalfOf(merge, name, onBehalfOf);
        if (resolution.status === 'denied') {
          this.#hardGate.recordOnBehalfDenied(name, toolUseId, {
            fallback: resolution.fallback,
            ...(resolution.subjectId ? { subjectId: resolution.subjectId } : {}),
            senders: merge.members.length,
          }, resolution.reason);
          return this.#deny(name, toolUseId, MERGE_ON_BEHALF_POLICY,
            `${resolution.reason}. In a merged turn, pass ${ON_BEHALF_OF_ARG} with the id of a sender who may do this.`, causedBy);
        }
        actingFor = resolution.member.subjectId;
      }
    }
    const decision = await runTurnToolPolicies({ turn: this.turn, tool, input, provenanceTainted: this.provenance.tainted });
    // File/cwd authorization is asynchronous: cancellation can arrive after
    // the ingress check but before an allowed decision reaches execution.
    if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
    if (decision.status === 'denied') {
      return this.#deny(name, toolUseId, decision.policy, decision.reason, causedBy);
    }
    let effectiveInput = decision.input;
    const highRisk = classifyHighRiskAction(tool);
    const humanOnly = tool.requiresApproval === 'human';
    const dangerous = this.#hardGate.assess(tool, effectiveInput).risk === 'dangerous';
    if (humanOnly || dangerous) {
      try {
        // Caller-owned nested values must not change the operation while a person reviews it.
        effectiveInput = structuredClone(effectiveInput);
        // Reject cycles and other non-serializable input before constructing the approval card.
        JSON.stringify(effectiveInput);
        if (highRisk === 'outbound' && this.#leakInspector) {
          // Show exactly what will execute; do not redact approved arguments afterward.
          effectiveInput = this.#leakInspector.inspectArguments(effectiveInput).input;
        }
      } catch {
        return this.#deny(name, toolUseId, 'approval', 'human approval requires an isolated JSON argument snapshot', causedBy);
      }
    }
    // ADR 0036 hard gate: independent of execApprovalMode / requiresApproval; a fresh human
    // approval here supersedes the ordinary approval and provenance prompts below.
    const hardGate = await this.#hardGate.check(tool, effectiveInput, toolUseId, actingFor ? { requesterId: actingFor } : {});
    if (hardGate.status === 'cancelled' || this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
    if (hardGate.status === 'denied') {
      return this.#deny(name, toolUseId, TOOL_HARD_GATE_POLICY, hardGate.reason, causedBy);
    }
    const provenanceGate = highRisk !== undefined
      && this.#guard.confirmHighRisk === 'external_content'
      && this.provenance.tainted;
    const denial: ApprovalDenialContext = { toolName: name, ...(highRisk ? { action: highRisk } : {}) };
    // A fresh human hard-gate approval, or an authority's provenance approval, covers the ordinary prompt.
    let authorizationRequired = decision.status === 'approval_required';
    if (hardGate.status === 'approved') {
      authorizationRequired = false;
    } else if (provenanceGate) {
      // #727 M3.3: a high-risk action after lower-trust content always asks
      // first, even when the configured policy would allow it outright.
      const blocked = this.#approvalBlocked('intent');
      if (blocked) {
        this.#auditApproval(name, PROVENANCE_POLICY, 'intent', { status: 'unavailable', reason: blocked });
        return this.#deny(name, toolUseId, PROVENANCE_POLICY, `${blocked === 'unattended'
          ? PROVENANCE_UNATTENDED_REASON
          : PROVENANCE_NO_CHANNEL_REASON} ${formatApprovalBlocked(blocked, denial)}`, causedBy);
      }
      const chain = this.provenance.describeChain(resolveTurnTrustLevel(this.turn), name);
      const approval = await requestApprovalOutcome(this.turn.ports.approval!, {
        ...(humanOnly ? { humanOnly: true } : {}),
        requestId: `${this.turn.identity.turnId}:${toolUseId}`,
        sessionKey: this.turn.session.key,
        ...(this.turn.origin.kind === 'im'
          ? { conversationScope: this.turn.origin.scope }
          : {}),
        requesterId: actingFor ?? this.turn.principal.subjectId,
        toolName: name,
        // Never matches a remembered approval: each tainted call is confirmed on its own.
        scopeKey: `${PROVENANCE_POLICY}:${this.turn.identity.turnId}:${toolUseId}`,
        purpose: 'intent',
        // #1250 review: an admin's own answer may cover the call only when the call itself needs no
        // authorization or the policy lets an admin authorize it; otherwise it needs the bot owner.
        ...(!authorizationRequired || (decision.status === 'approval_required' && decision.adminMayApprove)
          ? { adminMayApprove: true }
          : { requiresOwner: true }),
        question: formatApprovalQuestion(name, formatProvenanceReason(highRisk, chain), effectiveInput,
          humanOnly, tool.description),
        signal: this.turn.signal,
      });
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
      this.#auditApproval(name, PROVENANCE_POLICY, 'intent', approval);
      if (approval.status !== 'approved') {
        return this.#deny(name, toolUseId, PROVENANCE_POLICY, formatApprovalDenial(approval, denial), causedBy);
      }
      // #1250: an initiator-only confirmation proves intent, not authority; the ordinary approval still runs.
      if (approval.scope !== 'intent') authorizationRequired = false;
    }
    if (authorizationRequired && decision.status === 'approval_required') {
      // #1250 review: some policies only need the initiator to confirm their own intent (memory poisoning guard).
      const purpose = decision.purpose ?? 'authorization';
      const blocked = this.#approvalBlocked(purpose);
      if (blocked) {
        this.#auditApproval(name, decision.policy, purpose, { status: 'unavailable', reason: blocked });
        return this.#deny(name, toolUseId, decision.policy,
          formatApprovalBlocked(blocked, denial, blocked === 'no_channel' ? 'ApprovalPort unavailable' : undefined), causedBy);
      }
      const approval = await requestApprovalOutcome(this.turn.ports.approval!, {
        ...(humanOnly ? { humanOnly: true } : {}),
        requestId: `${this.turn.identity.turnId}:${toolUseId}`,
        sessionKey: this.turn.session.key,
        ...(this.turn.origin.kind === 'im'
          ? { conversationScope: this.turn.origin.scope }
          : {}),
        requesterId: actingFor ?? this.turn.principal.subjectId,
        toolName: name,
        // An intent confirmation never matches a remembered approval: each call is confirmed on its own.
        scopeKey: purpose === 'intent'
          ? `${decision.policy}:${this.turn.identity.turnId}:${toolUseId}`
          : tool.requiresApproval === 'once'
            ? name
            : approvalScopeKey(name, effectiveInput),
        ...(purpose !== 'intent' && (tool.requiresApproval === 'once' || decision.policy === 'exec-policy')
          ? { remember: 'session' as const }
          : {}),
        purpose,
        ...(decision.requiresOwner ? { requiresOwner: true } : {}),
        ...(decision.adminMayApprove ? { adminMayApprove: true } : {}),
        question: formatApprovalQuestion(name, decision.reason, effectiveInput, humanOnly, tool.description),
        signal: this.turn.signal,
      });
      if (this.turn.signal.aborted) return this.#cancel(name, toolUseId, 0, causedBy);
      this.#auditApproval(name, decision.policy, purpose, approval);
      // Fail closed if a surface ever answers an authorization request with an intent-only confirmation.
      if (approval.status !== 'approved' || (approval.scope === 'intent' && purpose !== 'intent')) {
        return this.#deny(name, toolUseId, decision.policy, approval.status === 'approved'
          ? formatApprovalBlocked('no_channel', denial, 'only the initiator confirmed; approval needs someone with authority')
          : formatApprovalDenial(approval, denial), causedBy);
      }
    }

    if (!humanOnly && highRisk === 'outbound' && this.#leakInspector) {
      // #727 M3.4: messages to other conversations go through the same leak check as replies.
      effectiveInput = this.#leakInspector.inspectArguments(effectiveInput).input;
    }

    // Keep the policy-approved identity even if a tool mutates its input while executing.
    const fileChange = (name === 'write_file' || name === 'edit_file') && typeof effectiveInput.file_path === 'string'
      ? Object.freeze({ path: effectiveInput.file_path })
      : undefined;
    const startedAt = Date.now();
    try {
      const effects = this.turn.ports.operationEvidence?.started({
        turnId: this.turn.identity.turnId, toolUseId, toolName: tool.name, readOnly: tool.readOnly === true,
      });
      const output = await tool.execute(effectiveInput, { ...toolInvocationFromTurn(this.turn), ...(effects ? { effects } : {}) });
      this.#observeOutput(tool, effectiveInput, output);
      const durationMs = Date.now() - startedAt;
      // A tool that ignores cancellation may already have committed side effects.
      // Record its real settlement so the audit trail never invites an unsafe retry.
      await this.#append({ type: 'tool_result', toolName: name, output, durationMs, toolUseId,
        ...(fileChange ? { fileChange } : {}) }, causedBy);
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
      return Object.freeze({ status: 'failed', error: message, retryable: false, sideEffect: tool.readOnly !== true });
    }
  }

  /** Unattended turns and turns without an approval surface cannot ask anyone (#1250: kept apart for the model). */
  #approvalBlocked(purpose: 'authorization' | 'intent'): ApprovalBlockReason | undefined {
    if (this.turn.policy.unattended) return 'unattended';
    return isApprovalPortAvailable(this.turn.ports.approval, purpose) ? undefined : 'no_channel';
  }

  /** Ordinary and provenance prompts are audited like hard-gate cards (`tool_approval`, channel `turn_prompt`). */
  #auditApproval(
    toolName: string,
    policy: string,
    purpose: 'authorization' | 'intent',
    outcome: ApprovalOutcome | Readonly<{ status: 'unavailable'; reason: string }>,
  ): void {
    const sink = this.#decisionAudit;
    if (!sink) return;
    const location = hardGateLocation(this.turn);
    const [outcomeKind, reasonCode] = outcome.status === 'approved'
      ? ['allow', 'tool_approval_approved'] as const
      : outcome.status === 'timed_out'
        ? ['deny', 'tool_approval_timeout'] as const
        : outcome.status === 'denied'
          ? ['deny', 'tool_approval_denied'] as const
          : ['deny', 'tool_approval_unavailable'] as const;
    try {
      const result = sink.record({
        turnId: this.turn.identity.turnId,
        instanceId: location.instanceId,
        platform: location.platform,
        sceneId: location.sceneId,
        userId: location.userId ?? null,
        kind: 'tool_approval',
        outcome: outcomeKind,
        reasonCode,
        ...(outcome.status === 'unavailable' ? { reasonDetail: outcome.reason } : {}),
        payload: {
          tool: toolName,
          policy,
          purpose,
          channel: 'turn_prompt',
          ...(outcome.status === 'approved' ? { decision: outcome.decision, ...(outcome.scope ? { scope: outcome.scope } : {}) } : {}),
          ...(outcome.status === 'denied' ? { by: outcome.by } : {}),
        },
        actor: 'system',
      });
      if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => undefined);
    } catch {
      // Auditing never decides: a failed write does not change the approval outcome.
    }
  }

  /** Records where the result came from, and which parts are another session's memory. */
  #observeOutput(tool: ToolCapability, input: Readonly<Record<string, unknown>>, output: unknown): void {
    if (isExternalContentSource(tool, this.#guard)) {
      this.provenance.record({ kind: 'tool_result', toolName: tool.name });
    }
    if (this.#leakInspector && readsOtherSessionMemory(input, this.turn.session.key)) {
      this.#leakInspector.protectOtherSessionMemory(collectText(output));
    }
  }

  async #deny(toolName: string, toolUseId: string, policy: string, reason: string, causedBy?: ToolExecutionCause): Promise<TurnToolOutcome> {
    await this.#append({ type: 'tool_denied', toolName, toolUseId, policy, reason }, causedBy);
    // #1250: unknown tools changed nothing; a known tool not declared read-only would have written.
    const tool = this.#tools.get(toolName);
    return Object.freeze({ status: 'denied', policy, reason, sideEffect: tool !== undefined && tool.readOnly !== true });
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

/** IM turns record where the dangerous call came from so the IM approval channel can deliver and guard it. */
function hardGateOrigin(turn: TurnIngress): { origin?: ToolApprovalOrigin } {
  if (turn.origin.kind !== 'im' || !turn.origin.endpoint) return {};
  return {
    origin: {
      platform: turn.origin.platform,
      endpointKey: turn.origin.endpoint,
      scope: turn.origin.scope,
      sceneId: turn.origin.sceneId,
    },
  };
}

function hardGateLocation(turn: TurnIngress): ToolHardGateLocation {
  if (turn.origin.kind === 'im') {
    return {
      instanceId: turn.origin.endpoint || turn.identity.rootId,
      platform: turn.origin.platform,
      sceneId: `${turn.origin.scope}:${turn.origin.sceneId}`,
      userId: turn.principal.subjectId,
    };
  }
  return {
    instanceId: turn.identity.rootId,
    platform: turn.origin.kind,
    sceneId: turn.session.key,
    userId: turn.principal.subjectId,
  };
}

function formatApprovalQuestion(
  toolName: string,
  reason: string,
  input: Readonly<Record<string, unknown>>,
  humanOnly: boolean,
  description?: string,
): string {
  const command = typeof input.command === 'string' ? redactSecretText(input.command.trim()) : '';
  const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
  const path = ['file_path', 'path'].map((key) => input[key]).find((value) => typeof value === 'string') as string | undefined;
  return [
    approvalActionLabel(toolName, description),
    command ? `命令：${command}` : undefined,
    cwd ? `工作目录：${cwd}` : undefined,
    path ? `目标文件：${path}` : undefined,
    humanOnly || (!command && !path && Object.keys(input).length > 0)
      ? `本次参数：${stableApprovalValue(redactApprovalDisplay(input))}`
      : undefined,
    // #1250 review: policy reasons can quote the raw command (exec-policy); mask secrets like the arguments.
    reason.startsWith('tool approval policy is ') ? undefined : `风险：${redactSecretText(reason)}`,
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
