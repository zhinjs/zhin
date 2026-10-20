import {
  canonicalWorkroomJson as stableJson,
  deepFreezeWorkroomValue as deepFreeze,
} from './canonical-value.js';
import {
  createInteractionSpaceBinding,
  type InteractionSpace,
  type InteractionSpaceBinding,
  type InteractionSpaceBindingRepository,
} from './interaction-space-router.js';
import {
  conversationRefKey,
  type ConversationRef,
} from '@zhin.js/im-contract';

export interface ConversationSequenceBarrier {
  readonly version: 1;
  readonly conversationKey: string;
  readonly currentSequence: number;
  readonly sourceRef: string;
  readonly sourceDigest: string;
}

export interface ConversationSequenceBarrierPort {
  readBarrier(conversation: ConversationRef): Promise<ConversationSequenceBarrier>;
}

export interface InteractionSpaceBindingAuthorizationRequest {
  readonly version: 1;
  readonly conversation: ConversationRef;
  readonly conversationKey: string;
  readonly expectedRevision: number;
  readonly bindingRevision: number;
  readonly effectiveAfterConversationSequence: number;
  readonly barrierSourceRef: string;
  readonly barrierSourceDigest: string;
  readonly space: InteractionSpace;
  readonly projectId?: string;
  readonly sourceRef: string;
  readonly sourceDigest: string;
}

type InteractionSpaceBindingAuthorizationEcho = InteractionSpaceBindingAuthorizationRequest;

export type InteractionSpaceBindingAuthorizationDecision =
  | Readonly<InteractionSpaceBindingAuthorizationEcho & {
      readonly authorized: true;
      readonly authorizedBy: string;
    }>
  | Readonly<InteractionSpaceBindingAuthorizationEcho & {
      readonly authorized: false;
      readonly reason: string;
    }>;

export interface InteractionSpaceBindingAuthorityPort {
  authorize(
    request: Readonly<InteractionSpaceBindingAuthorizationRequest>,
  ): InteractionSpaceBindingAuthorizationDecision
    | Promise<InteractionSpaceBindingAuthorizationDecision>;
}

export interface BindInteractionSpaceInput {
  readonly conversation: ConversationRef;
  readonly space: InteractionSpace;
  readonly projectId?: string;
  readonly sourceRef: string;
  readonly sourceDigest: string;
}

/**
 * Issues one explicit Interaction Space binding from trusted conversation and
 * Project-authority facts. Callers provide neither revisions nor sequence anchors.
 */
export class InteractionSpaceBindingService {
  constructor(
    readonly repository: InteractionSpaceBindingRepository,
    readonly barrier: ConversationSequenceBarrierPort,
    readonly authority?: InteractionSpaceBindingAuthorityPort,
  ) {}

  async bind(input: BindInteractionSpaceInput): Promise<InteractionSpaceBinding> {
    const normalized = normalizeBindInput(input);
    const authority = this.authority;
    if (!authority) throw new Error('Interaction Space Binding Authority Port is not installed');
    const conversationKey = conversationRefKey(normalized.conversation);
    const history = normalizeHistory(
      normalized.conversation,
      await this.repository.read(conversationKey),
    );
    const replay = findReplay(history, normalized);
    if (replay) return replay;

    const currentBarrier = normalizeBarrier(
      await this.barrier.readBarrier(normalized.conversation),
      conversationKey,
    );
    const previous = history.at(-1);
    if (previous
      && currentBarrier.currentSequence < previous.effectiveAfterConversationSequence) {
      throw new Error('Interaction Space binding barrier must not move behind the previous anchor');
    }
    const request = deepFreeze<InteractionSpaceBindingAuthorizationRequest>({
      version: 1,
      conversation: normalized.conversation,
      conversationKey,
      expectedRevision: history.length,
      bindingRevision: history.length + 1,
      effectiveAfterConversationSequence: currentBarrier.currentSequence,
      barrierSourceRef: currentBarrier.sourceRef,
      barrierSourceDigest: currentBarrier.sourceDigest,
      space: normalized.space,
      ...(normalized.projectId === undefined ? {} : { projectId: normalized.projectId }),
      sourceRef: normalized.sourceRef,
      sourceDigest: normalized.sourceDigest,
    });
    const decision = normalizeDecision(await authority.authorize(request), request);
    if (!decision.authorized) {
      throw new Error(`Interaction Space binding authority denied: ${decision.reason}`);
    }
    const binding = createInteractionSpaceBinding({
      conversation: normalized.conversation,
      bindingRevision: decision.bindingRevision,
      effectiveAfterConversationSequence: decision.effectiveAfterConversationSequence,
      space: decision.space,
      ...(decision.projectId === undefined ? {} : { projectId: decision.projectId }),
      sourceRef: decision.sourceRef,
      sourceDigest: decision.sourceDigest,
    });
    const appended = await this.repository.append(conversationKey, decision.expectedRevision, [binding]);
    if (appended.length !== 1 || stableJson(appended[0]) !== stableJson(binding)) {
      throw new Error('Interaction Space binding repository append result drift');
    }
    return appended[0]!;
  }
}

function normalizeBindInput(input: BindInteractionSpaceInput): Readonly<BindInteractionSpaceInput> {
  const snapshot = structuredClone(input) as BindInteractionSpaceInput;
  assertObject(snapshot, 'binding input');
  assertExactKeys(snapshot, ['conversation', 'space', 'projectId', 'sourceRef', 'sourceDigest'], 'binding input');
  const conversation = deepFreeze(structuredClone(snapshot.conversation));
  const probe = createInteractionSpaceBinding({
    conversation,
    bindingRevision: 1,
    effectiveAfterConversationSequence: 0,
    space: snapshot.space,
    ...(snapshot.projectId === undefined ? {} : { projectId: snapshot.projectId }),
    sourceRef: snapshot.sourceRef,
    sourceDigest: snapshot.sourceDigest,
  });
  return deepFreeze({
    conversation,
    space: probe.space,
    ...(probe.projectId === undefined ? {} : { projectId: probe.projectId }),
    sourceRef: probe.sourceRef,
    sourceDigest: probe.sourceDigest,
  });
}

function normalizeHistory(
  conversation: ConversationRef,
  value: readonly InteractionSpaceBinding[],
): readonly InteractionSpaceBinding[] {
  if (!Array.isArray(value)) throw new Error('Interaction Space binding history must be an array');
  let previous: InteractionSpaceBinding | undefined;
  const history = value.map((binding, index) => {
    const canonical = createInteractionSpaceBinding({
      conversation,
      bindingRevision: binding.bindingRevision,
      effectiveAfterConversationSequence: binding.effectiveAfterConversationSequence,
      space: binding.space,
      ...(binding.projectId === undefined ? {} : { projectId: binding.projectId }),
      sourceRef: binding.sourceRef,
      sourceDigest: binding.sourceDigest,
    });
    if (stableJson(binding) !== stableJson(canonical)) {
      throw new Error('Interaction Space binding history contains a non-canonical fact');
    }
    if (canonical.bindingRevision !== index + 1) {
      throw new Error('Interaction Space binding history revision is not contiguous');
    }
    if (previous
      && canonical.effectiveAfterConversationSequence
        < previous.effectiveAfterConversationSequence) {
      throw new Error('Interaction Space binding history anchor moved backwards');
    }
    previous = canonical;
    return canonical;
  });
  return deepFreeze(history);
}

function findReplay(
  history: readonly InteractionSpaceBinding[],
  input: Readonly<BindInteractionSpaceInput>,
): InteractionSpaceBinding | undefined {
  const prior = history.find(binding => binding.sourceRef === input.sourceRef);
  if (!prior) return undefined;
  const exact = prior.space === input.space
    && prior.projectId === input.projectId
    && prior.sourceDigest === input.sourceDigest;
  if (!exact) throw new Error('Interaction Space binding source replay payload drift');
  return prior;
}

function normalizeBarrier(value: unknown, conversationKey: string): ConversationSequenceBarrier {
  const snapshot = structuredClone(value) as ConversationSequenceBarrier;
  assertObject(snapshot, 'conversation barrier');
  assertExactKeys(snapshot, [
    'version', 'conversationKey', 'currentSequence', 'sourceRef', 'sourceDigest',
  ], 'conversation barrier');
  if (snapshot.version !== 1 || snapshot.conversationKey !== conversationKey) {
    throw new Error('Interaction Space conversation barrier does not match the conversation');
  }
  nonNegativeInteger(snapshot.currentSequence, 'conversation barrier currentSequence');
  canonicalText(snapshot.sourceRef, 'conversation barrier sourceRef');
  sha256(snapshot.sourceDigest, 'conversation barrier sourceDigest');
  return deepFreeze({
    version: 1,
    conversationKey,
    currentSequence: snapshot.currentSequence,
    sourceRef: snapshot.sourceRef,
    sourceDigest: snapshot.sourceDigest,
  });
}

function normalizeDecision(
  value: unknown,
  request: InteractionSpaceBindingAuthorizationRequest,
): InteractionSpaceBindingAuthorizationDecision {
  const snapshot = structuredClone(value) as InteractionSpaceBindingAuthorizationDecision;
  assertObject(snapshot, 'authority decision');
  if (snapshot.authorized !== true && snapshot.authorized !== false) {
    throw new Error('Interaction Space binding authority decision is invalid');
  }
  const outcomeKey = snapshot.authorized ? 'authorizedBy' : 'reason';
  assertExactKeys(snapshot, [...Object.keys(request), 'authorized', outcomeKey], 'authority decision');
  for (const key of Object.keys(request) as (keyof InteractionSpaceBindingAuthorizationRequest)[]) {
    if (stableJson(snapshot[key]) !== stableJson(request[key])) {
      throw new Error(`Interaction Space binding authority decision is stale for ${key}`);
    }
  }
  if (snapshot.authorized) {
    canonicalText(snapshot.authorizedBy, 'authority decision authorizedBy');
  } else {
    canonicalText(snapshot.reason, 'authority decision reason');
  }
  return deepFreeze(snapshot);
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Interaction Space ${field} must be an object`);
  }
}

function assertExactKeys(value: object, allowed: readonly string[], field: string): void {
  const allow = new Set(allowed);
  const unexpected = Object.keys(value).find(key => !allow.has(key));
  if (unexpected) throw new Error(`Interaction Space ${field} contains forbidden field ${unexpected}`);
}

function canonicalText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Interaction Space ${field} must be canonical text`);
  }
}

function sha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Interaction Space ${field} must be a canonical SHA-256 digest`);
  }
}

function nonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Interaction Space ${field} must be a non-negative integer`);
  }
}
