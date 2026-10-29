import type { HostProtectedPaths } from '../security/host-config-paths.js';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import type { Usage } from '@zhin.js/ai';
import type { ApprovalPort } from '../session/approval-port.js';
import type { PermissionSubject } from '@zhin.js/permission';
import type {
  ToolInvocationContext,
  ToolInvocationOrigin,
  ToolQuestionPort,
} from '@zhin.js/tool';
import type { ScheduleJobCreator, ScheduleJobExecutionPlan } from '../assistant/types.js';
import type { ConversationContextBlock } from '@zhin.js/im-contract';
import type { AiOutboundSegmentProfile } from '@zhin.js/core';

export type TurnScope = 'private' | 'group' | 'channel';

export type TurnOrigin = Exclude<ToolInvocationOrigin, Readonly<{ kind: 'mcp'; requestId: string }>>;

export interface TurnIdentity {
  readonly rootId: string;
  readonly generation: number;
  readonly traceId: string;
  readonly turnId: string;
}

/** 入站来源（与 `@zhin.js/core` 的 MessageOrigin 同一联合，此处重复声明以避免新耦合）。 */
export type TurnPrincipalOrigin = 'self' | 'member' | 'peer_bot' | 'human';

export interface TurnPrincipal {
  readonly subjectId: string;
  readonly displayName?: string;
  readonly roles: readonly string[];
  /** IM Runtime 可信判定的入站来源；仅 `human` 能构造 turn。缺省表示合成入口。 */
  readonly origin?: TurnPrincipalOrigin;
}

export type TurnIntentKind = 'new' | 'steer' | 'follow_up' | 'supersede' | 'observe';

/** Product-resolved semantics for how an ingress affects a shared active turn. */
export interface TurnIntent {
  readonly kind: TurnIntentKind;
  readonly targetTurnId?: string;
  /** Required when product policy allows one principal to control another principal's turn. */
  readonly authorizedBy?: 'product_policy';
}

export interface TurnMedia {
  readonly kind: 'image' | 'audio' | 'video' | 'file';
  readonly source: Readonly<{
    kind: 'url' | 'path' | 'base64' | 'platform_ref';
    value: string;
  }>;
  readonly mimeType?: string;
  readonly name?: string;
  /** Current-turn scoped key used to materialize an opaque platform reference. */
  readonly referenceKey?: string;
}

export interface TurnReference {
  readonly key: string;
  readonly kind: 'message' | 'forward' | 'media';
  readonly sourceId: string;
  readonly preview?: string;
}

export type TurnReferenceResolution =
  | Readonly<{ status: 'resolved'; content: unknown; truncated?: boolean }>
  | Readonly<{ status: 'not_found' | 'unsupported' | 'forbidden' | 'expired' | 'failed'; code: string; message?: string }>;

export interface ReferencePort {
  resolve(
    key: string,
    options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
    signal: AbortSignal,
  ): Promise<TurnReferenceResolution>;
}

export interface ConversationContextPort {
  readPending(signal: AbortSignal): Promise<Readonly<{
    blocks: readonly ConversationContextBlock[];
    cursor: number;
  }>>;
  commit(cursor: number): Promise<void>;
}

/** Current-conversation facts resolved by the trusted ingress, never adapter metadata. */
export interface TurnContextState {
  readonly bot?: Readonly<{
    /** Platform account id, not the configured Endpoint name. */
    id?: string;
    name?: string;
    platformRole?: string;
    /** Stable lookup outcome code; role remains unknown when the platform read fails. */
    platformRoleError?: string;
    /** Missing/null is unknown; 0 means confirmed unmuted; positive values are expiry timestamps. */
    mutedUntil?: number | null;
    status?: string;
  }>;
  readonly conversation?: Readonly<{
    /** Conversation-specific data; platform-wide instructions belong to the system prompt. */
    rules?: readonly string[];
    muteAll?: boolean;
  }>;
}

export interface TurnInput {
  /** Product-resolved display context, independent of untrusted adapter metadata. */
  readonly locale?: import('@zhin.js/plugin-runtime').Locale;
  readonly commandPrefix?: string;
  readonly commandMenu?: string;
  readonly text: string;
  readonly media?: readonly TurnMedia[];
  readonly references?: readonly TurnReference[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly contextState?: TurnContextState;
  /**
   * #996 product-resolved scene event summaries (newest first, already short and truncated).
   * Injected as the ephemeral `[Scene events]` block; never stored in agent_messages.
   */
  readonly sceneEvents?: readonly string[];
  /**
   * ADR 0038 §3: the senders of a merged turn (two or more), rendered as the
   * `[Merged turn]` lines of the turn context.
   */
  readonly mergedSenders?: readonly import('./merged-turn-context.js').TurnMergedSender[];
  /**
   * ADR 0038 §5: the danmaku window a live-stream turn answers, rendered as
   * the `[Danmaku window]` lines of the turn context.
   */
  readonly liveDanmaku?: import('./live-turn-context.js').TurnLiveDanmaku;
}

export interface TurnSessionAddress {
  readonly key: string;
}

export interface TurnPolicyContext {
  readonly permissions: readonly string[];
  readonly unattended: boolean;
  /** Explicit network authority; absence means network access is disabled. */
  readonly network?: Readonly<{
    readonly enabled: boolean;
    readonly httpsOnly?: boolean;
    readonly allowedDomains?: readonly string[];
  }>;
  /** Explicit shell command authority; absence disables canonical Shell execution. */
  readonly shell?: Readonly<{
    /** Optional strict command preset. When present it can only narrow execution. */
    readonly preset?: 'readonly' | 'network';
    /** Per-turn shell policy resolved by a trusted product ingress. */
    readonly security?: 'deny' | 'allowlist' | 'full';
    readonly execPreset?: 'readonly' | 'network' | 'development' | 'custom';
    readonly approvalMode?: 'ask' | 'bypass' | 'auto';
    /** Require an OS/container boundary for Shell execution. */
    readonly isolation?: 'required' | 'none';
  }>;
  /** Explicit filesystem authority; absence denies every file capability. */
  readonly filesystem?: Readonly<{
    readonly workspaceRoot: string;
    readonly workingDirectory?: string;
    readonly access?: 'read-only' | 'workspace-write' | 'danger-full-access';
  }>;
  /**
   * ADR 0038 §2: present only on a merged group turn. Lists every sender the
   * turn answers, each with the Tool names visible to that sender alone, so a
   * side-effect call can be re-checked against the person it acts for.
   */
  readonly merge?: Readonly<{
    readonly members: readonly TurnMergedMember[];
  }>;
}

/** One sender of a merged turn (ADR 0038 §2). */
export interface TurnMergedMember {
  readonly subjectId: string;
  readonly displayName?: string;
  /** Tool names this sender could use in a turn of their own. */
  readonly tools: readonly string[];
}

export type TurnExecutionProfile =
  | Readonly<{ kind: 'interactive' }>
  | Readonly<{
      kind: 'schedule';
      executionPlan?: Readonly<ScheduleJobExecutionPlan>;
      createdBy?: Readonly<ScheduleJobCreator>;
      security: Readonly<{
        execPreset: 'readonly' | 'network';
        allowedDomains: readonly string[];
      }>;
    }>;

export interface FrozenCapabilityCatalog {
  readonly tools: readonly string[];
  readonly skills: readonly string[];
}

export type DeliveryOutcome =
  | Readonly<{ status: 'sent'; messageId?: string }>
  | Readonly<{ status: 'suppressed' }>
  | Readonly<{ status: 'unsupported'; code: string }>
  | Readonly<{ status: 'rejected'; code: string }>
  | Readonly<{ status: 'failed'; code: string; retryable: boolean }>;

export interface ReplyPort {
  send(output: readonly AgentOutputElement[]): Promise<DeliveryOutcome>;
  /** What the reply endpoint lets the model author; absent means the core default set. */
  readonly segments?: AiOutboundSegmentProfile;
}

export interface ActivityPort {
  publish(event: Readonly<{ type: string; data?: unknown }>): void | Promise<void>;
}

export interface TurnJournalPort {
  append(event: import('../event/turn-event.js').TurnEvent): void | Promise<void>;
}

export interface DeliveryIntent {
  readonly intentId: string;
  readonly parentTurnId: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly output: readonly AgentOutputElement[];
}

export interface DeliveryPort {
  deliver(intent: DeliveryIntent, signal: AbortSignal): Promise<DeliveryOutcome>;
}

export interface TurnPorts {
  readonly journal: TurnJournalPort;
  readonly reply?: ReplyPort;
  readonly approval?: ApprovalPort;
  readonly activity?: ActivityPort;
  readonly delivery?: DeliveryPort;
  readonly question?: ToolQuestionPort;
  readonly references?: ReferencePort;
  readonly conversationContext?: ConversationContextPort;
  /** Runtime-only native Client capability; absent for detached/scheduled turns. */
  readonly client?: NonNullable<ToolInvocationContext['client']>;
}

/** Ports supplied by an ingress adapter; Journal authority is injected by AgentRuntime. */
export type TurnRequestPorts = Omit<TurnPorts, 'journal'>;

export interface TurnIngress {
  readonly identity: Readonly<TurnIdentity>;
  readonly origin: TurnOrigin;
  readonly principal: Readonly<TurnPrincipal>;
  readonly intent: Readonly<TurnIntent>;
  readonly input: Readonly<TurnInput>;
  readonly session: Readonly<TurnSessionAddress>;
  readonly policy: Readonly<TurnPolicyContext>;
  readonly execution: TurnExecutionProfile;
  readonly capabilities: Readonly<FrozenCapabilityCatalog>;
  readonly signal: AbortSignal;
  readonly ports: Readonly<TurnPorts>;
  /**
   * #1030: the generation's host-protected path set (project root anchored). `undefined` means the
   * host injected none, and the file/bash policy fails closed to name matching at any depth.
   * Production Turn construction sites must pass it explicitly (see the construction-site test).
   */
  readonly hostProtectedPaths?: HostProtectedPaths;
}

export type TurnIngressInput = Omit<TurnIngress, 'execution'> & {
  readonly execution?: TurnExecutionProfile;
};

export interface TurnRequest {
  readonly identity: Readonly<{
    traceId: string;
    turnId: string;
  }>;
  readonly origin: TurnOrigin;
  readonly principal: Readonly<TurnPrincipal>;
  readonly intent: TurnIntent;
  readonly input: Readonly<TurnInput>;
  readonly session: Readonly<TurnSessionAddress>;
  readonly policy: Readonly<TurnPolicyContext>;
  readonly execution?: TurnExecutionProfile;
  readonly signal: AbortSignal;
  readonly ports: Readonly<TurnRequestPorts>;
}

export type TurnAccessContext = Pick<TurnRequest, 'origin' | 'principal' | 'policy'> & Readonly<{
  input?: Pick<TurnInput, 'contextState'>;
}>;

export type TurnOutcome =
  | Readonly<{ status: 'completed'; output: readonly AgentOutputElement[]; usage: Usage }>
  | Readonly<{ status: 'failed'; error: Readonly<{ code: string; message: string; retryable: boolean }>; usage: Usage }>
  | Readonly<{ status: 'cancelled'; reason: string; usage: Usage }>
  | Readonly<{ status: 'budget_exceeded'; budget: string; usage: Usage }>;

export function createTurnIngress(input: TurnIngressInput): TurnIngress {
  requireText(input.identity.rootId, 'identity.rootId');
  requireText(input.identity.traceId, 'identity.traceId');
  requireText(input.identity.turnId, 'identity.turnId');
  if (!Number.isSafeInteger(input.identity.generation) || input.identity.generation < 0) {
    throw new TypeError('TurnIngress identity.generation must be a non-negative integer');
  }
  requireText(input.session.key, 'session.key');
  requireText(input.principal.subjectId, 'principal.subjectId');
  if (input.policy.unattended && (input.ports.reply || input.ports.approval || input.ports.question)) {
    throw new TypeError('Unattended TurnIngress cannot expose interactive ports');
  }
  if (!input.ports.journal || typeof input.ports.journal.append !== 'function') {
    throw new TypeError('TurnIngress ports.journal is required');
  }
  if (!(input.signal instanceof AbortSignal)) {
    throw new TypeError('TurnIngress signal must be an AbortSignal');
  }
  if (input.input.references?.length && !input.ports.references) {
    throw new TypeError('TurnIngress with references requires a ReferencePort');
  }

  const execution: TurnExecutionProfile = input.execution ?? Object.freeze({ kind: 'interactive' });
  if (!input.intent) {
    throw new TypeError('TurnIngress intent is required');
  }
  validateTurnIntent(input.intent);
  validateExecutionAuthority(input, execution);
  return Object.freeze({
    identity: freezeData(input.identity),
    origin: freezeData(input.origin),
    principal: freezeData(input.principal),
    intent: freezeData(input.intent),
    input: freezeData(input.input),
    session: freezeData(input.session),
    policy: freezeData(input.policy),
    execution: freezeData(execution),
    capabilities: freezeData(input.capabilities),
    signal: input.signal,
    ports: Object.freeze({ ...input.ports }),
    ...(input.hostProtectedPaths ? { hostProtectedPaths: input.hostProtectedPaths } : {}),
  });
}

function validateTurnIntent(intent: TurnIntent): void {
  if (!['new', 'steer', 'follow_up', 'supersede', 'observe'].includes(intent.kind)) {
    throw new TypeError(`TurnIngress intent.kind is invalid: ${String(intent.kind)}`);
  }
  if (intent.targetTurnId !== undefined) requireText(intent.targetTurnId, 'intent.targetTurnId');
  if (intent.authorizedBy !== undefined && intent.authorizedBy !== 'product_policy') {
    throw new TypeError(`TurnIngress intent.authorizedBy is invalid: ${String(intent.authorizedBy)}`);
  }
}

function validateExecutionAuthority(
  input: TurnIngressInput,
  execution: TurnExecutionProfile,
): void {
  if (execution.kind !== 'schedule') {
    if (input.origin.kind === 'schedule') {
      throw new TypeError('Schedule origin requires a schedule execution profile');
    }
    return;
  }
  if (input.origin.kind !== 'schedule') {
    throw new TypeError('Schedule execution profile requires a schedule origin');
  }
  if (!input.policy.unattended) {
    throw new TypeError('Schedule execution profile must be unattended');
  }
  if (!input.policy.network?.enabled || input.policy.network.httpsOnly !== true) {
    throw new TypeError('Schedule execution requires explicit HTTPS network authority');
  }
  if (input.policy.shell?.preset !== execution.security.execPreset) {
    throw new TypeError('Schedule Shell authority must match its execution profile');
  }
  const policyDomains = [...(input.policy.network.allowedDomains ?? [])].sort();
  const profileDomains = [...execution.security.allowedDomains].sort();
  if (policyDomains.length !== profileDomains.length
    || policyDomains.some((domain, index) => domain !== profileDomains[index])) {
    throw new TypeError('Schedule network authority must match its execution profile');
  }
}

export function turnPermissionSubject(turn: TurnAccessContext): PermissionSubject {
  const im = turn.origin.kind === 'im' ? turn.origin : undefined;
  return Object.freeze({
    ...(im ? { adapter: im.platform, endpoint: im.endpoint } : {}),
    ...(im ? { scene: Object.freeze({ id: im.sceneId, type: im.scope }) } : {}),
    sender: Object.freeze({
      id: turn.principal.subjectId,
      ...(turn.principal.displayName ? { name: turn.principal.displayName } : {}),
      role: turn.principal.roles,
      permissions: turn.policy.permissions,
    }),
  });
}

export function resolveTurnContextValue(turn: TurnIngress, key: string): unknown {
  const im = turn.origin.kind === 'im' ? turn.origin : undefined;
  switch (key) {
    case 'platform': return im?.platform;
    case 'endpointKey': return im?.endpoint;
    case 'messageId': return im?.messageId;
    case 'sceneId': return im?.sceneId;
    case 'senderId': return turn.principal.subjectId;
    case 'scope': return im?.scope;
    case 'sessionKey': return turn.session.key;
    case 'turnId': return turn.identity.turnId;
    case 'traceId': return turn.identity.traceId;
    default: return turn.input.metadata?.[key];
  }
}

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new TypeError(`TurnIngress ${field} is required`);
}

function freezeData<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeData(item))) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const result = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, freezeData(item)]),
  );
  return Object.freeze(result) as T;
}
