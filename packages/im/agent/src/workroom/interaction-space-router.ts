import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import {
  conversationRefKey,
  type ConversationRef,
} from '@zhin.js/im-contract';

export type InteractionSpace = 'chat' | 'workroom' | 'sponsor_room';

export interface InteractionSpaceBindingInput {
  readonly conversation: ConversationRef;
  readonly bindingRevision: number;
  readonly effectiveAfterConversationSequence: number;
  readonly space: InteractionSpace;
  readonly projectId?: string;
  readonly sourceRef: string;
  readonly sourceDigest: string;
}

export interface InteractionSpaceBinding {
  readonly version: 1;
  readonly conversationKey: string;
  readonly bindingRevision: number;
  readonly effectiveAfterConversationSequence: number;
  readonly space: InteractionSpace;
  readonly projectId?: string;
  readonly sourceRef: string;
  readonly sourceDigest: string;
  readonly digest: string;
}

export interface InteractionSpaceBindingRepository {
  read(conversationKey: string): Promise<readonly InteractionSpaceBinding[]>;
  append(
    conversationKey: string,
    expectedRevision: number,
    bindings: readonly InteractionSpaceBinding[],
  ): Promise<readonly InteractionSpaceBinding[]>;
}

export type InteractionSpaceDecision =
  | Readonly<{
      status: 'resolved';
      conversationKey: string;
      conversationSequence?: number;
      source: 'default';
      space: 'chat';
    }>
  | Readonly<{
      status: 'resolved';
      conversationKey: string;
      conversationSequence: number;
      source: 'binding';
      space: InteractionSpace;
      bindingRevision: number;
      bindingDigest: string;
      projectId?: string;
    }>
  | Readonly<{
      status: 'rejected';
      conversationKey: string;
      reason: 'conversation_sequence_required';
    }>
  | Readonly<{
      status: 'ignored';
      conversationKey: string;
      conversationSequence: number;
      bindingRevision: number;
      bindingDigest: string;
      reason: 'not_after_current_binding_anchor';
    }>;

export interface ResolveInteractionSpaceInput {
  readonly conversation: ConversationRef;
  readonly conversationSequence?: number;
}

/**
 * Resolves product-owned Interaction Space before chat commands or Agent
 * triggering. It uses only durable binding history and the conversation event
 * sequence; transport scope and message text never influence the decision.
 */
export class InteractionSpaceRouter {
  constructor(readonly repository: InteractionSpaceBindingRepository) {}

  async resolve(input: ResolveInteractionSpaceInput): Promise<InteractionSpaceDecision> {
    assertConversationRef(input.conversation);
    const key = conversationRefKey(input.conversation);
    if (input.conversationSequence !== undefined) {
      positiveInteger(input.conversationSequence, 'conversationSequence');
    }
    const history = await this.repository.read(key);
    validateHistory(key, history);
    if (history.length === 0) {
      return deepFreeze({
        status: 'resolved' as const,
        conversationKey: key,
        ...(input.conversationSequence !== undefined
          ? { conversationSequence: input.conversationSequence }
          : {}),
        source: 'default' as const,
        space: 'chat' as const,
      });
    }
    if (input.conversationSequence === undefined) {
      return deepFreeze({
        status: 'rejected' as const,
        conversationKey: key,
        reason: 'conversation_sequence_required' as const,
      });
    }
    const active = history.at(-1)!;
    if (input.conversationSequence <= active.effectiveAfterConversationSequence) {
      return deepFreeze({
        status: 'ignored' as const,
        conversationKey: key,
        conversationSequence: input.conversationSequence,
        bindingRevision: active.bindingRevision,
        bindingDigest: active.digest,
        reason: 'not_after_current_binding_anchor' as const,
      });
    }
    return deepFreeze({
      status: 'resolved' as const,
      conversationKey: key,
      conversationSequence: input.conversationSequence,
      source: 'binding' as const,
      space: active.space,
      bindingRevision: active.bindingRevision,
      bindingDigest: active.digest,
      ...(active.projectId ? { projectId: active.projectId } : {}),
    });
  }
}

/** In-memory contract adapter; production storage may implement the same CAS seam. */
export class MemoryInteractionSpaceBindingRepository implements InteractionSpaceBindingRepository {
  readonly #bindings = new Map<string, readonly InteractionSpaceBinding[]>();

  async read(conversationKey: string): Promise<readonly InteractionSpaceBinding[]> {
    text(conversationKey, 'conversationKey');
    return Object.freeze([...(this.#bindings.get(conversationKey) ?? [])]);
  }

  async append(
    conversationKey: string,
    expectedRevision: number,
    bindings: readonly InteractionSpaceBinding[],
  ): Promise<readonly InteractionSpaceBinding[]> {
    text(conversationKey, 'conversationKey');
    nonNegativeInteger(expectedRevision, 'expectedRevision');
    if (bindings.length === 0) throw new Error('Interaction Space binding append requires facts');
    const current = this.#bindings.get(conversationKey) ?? Object.freeze([]);
    validateHistory(conversationKey, current);
    const normalized = bindings.map(binding => normalizeBinding(binding, conversationKey));

    if (expectedRevision < current.length) {
      const replay = current.slice(expectedRevision, expectedRevision + normalized.length);
      if (replay.length === normalized.length
        && replay.every((binding, index) => binding.digest === normalized[index]?.digest)) {
        return Object.freeze([...replay]);
      }
      throw new Error('Interaction Space binding replay conflict');
    }
    if (expectedRevision !== current.length) {
      throw new Error(`Interaction Space binding revision conflict: expected ${expectedRevision}, actual ${current.length}`);
    }

    const next = [...current];
    for (const binding of normalized) {
      const previous = next.at(-1);
      const expectedBindingRevision = (previous?.bindingRevision ?? 0) + 1;
      if (binding.bindingRevision !== expectedBindingRevision) {
        throw new Error('Interaction Space binding revisions must be contiguous');
      }
      if (previous
        && binding.effectiveAfterConversationSequence
          < previous.effectiveAfterConversationSequence) {
        throw new Error('Interaction Space binding anchor must not move backwards');
      }
      next.push(binding);
    }
    const stored = Object.freeze(next);
    this.#bindings.set(conversationKey, stored);
    return Object.freeze(normalized);
  }
}

export function createInteractionSpaceBinding(
  input: InteractionSpaceBindingInput,
): InteractionSpaceBinding {
  assertConversationRef(input.conversation);
  positiveInteger(input.bindingRevision, 'bindingRevision');
  nonNegativeInteger(
    input.effectiveAfterConversationSequence,
    'effectiveAfterConversationSequence',
  );
  const space = interactionSpace(input.space);
  const projectId = input.projectId === undefined ? undefined : text(input.projectId, 'projectId');
  if (space !== 'chat' && !projectId) {
    throw new Error(`Interaction Space ${space} requires projectId`);
  }
  if (space === 'chat' && projectId !== undefined) {
    throw new Error('Interaction Space chat must not carry projectId');
  }
  const projection = {
    version: 1 as const,
    conversationKey: conversationRefKey(input.conversation),
    bindingRevision: input.bindingRevision,
    effectiveAfterConversationSequence: input.effectiveAfterConversationSequence,
    space,
    ...(projectId ? { projectId } : {}),
    sourceRef: text(input.sourceRef, 'sourceRef'),
    sourceDigest: sha256(input.sourceDigest, 'sourceDigest'),
  };
  return deepFreeze({ ...projection, digest: digest(projection) });
}

function normalizeBinding(
  value: InteractionSpaceBinding,
  conversationKey: string,
): InteractionSpaceBinding {
  if (!value || typeof value !== 'object') throw new Error('Interaction Space binding is required');
  exactKeys(value as unknown as Record<string, unknown>, [
    'version', 'conversationKey', 'bindingRevision', 'effectiveAfterConversationSequence',
    'space', 'projectId', 'sourceRef', 'sourceDigest', 'digest',
  ], 'Interaction Space binding');
  if (value.conversationKey !== conversationKey) {
    throw new Error('Interaction Space binding conversation does not match repository scope');
  }
  const space = interactionSpace(value.space);
  const projectId = value.projectId === undefined
    ? undefined
    : canonicalText(value.projectId, 'projectId');
  const sourceRef = canonicalText(value.sourceRef, 'sourceRef');
  const sourceDigest = sha256(value.sourceDigest, 'sourceDigest');
  const projection = {
    version: 1 as const,
    conversationKey,
    bindingRevision: value.bindingRevision,
    effectiveAfterConversationSequence: value.effectiveAfterConversationSequence,
    space,
    ...(projectId !== undefined ? { projectId } : {}),
    sourceRef,
    sourceDigest,
  };
  positiveInteger(projection.bindingRevision, 'bindingRevision');
  nonNegativeInteger(
    projection.effectiveAfterConversationSequence,
    'effectiveAfterConversationSequence',
  );
  if (space !== 'chat' && !projectId) throw new Error(`${space} binding requires projectId`);
  if (space === 'chat' && projectId !== undefined) throw new Error('chat binding must not carry projectId');
  if (value.version !== 1 || value.digest !== digest(projection)) {
    throw new Error('Interaction Space binding digest is invalid');
  }
  return deepFreeze({ ...projection, digest: value.digest });
}

function validateHistory(conversationKey: string, history: readonly InteractionSpaceBinding[]): void {
  let previous: InteractionSpaceBinding | undefined;
  history.forEach((value, index) => {
    const binding = normalizeBinding(value, conversationKey);
    if (binding.bindingRevision !== index + 1) {
      throw new Error('Interaction Space binding history revision is not contiguous');
    }
    if (previous
      && binding.effectiveAfterConversationSequence
        < previous.effectiveAfterConversationSequence) {
      throw new Error('Interaction Space binding history anchor moved backwards');
    }
    previous = binding;
  });
}

function interactionSpace(value: unknown): InteractionSpace {
  if (value !== 'chat' && value !== 'workroom' && value !== 'sponsor_room') {
    throw new Error('Interaction Space is invalid');
  }
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function assertConversationRef(value: ConversationRef): void {
  if (!value || typeof value !== 'object') throw new Error('ConversationRef is required');
  exactKeys(value as unknown as Record<string, unknown>, [
    'endpoint', 'kind', 'id', 'parent', 'threadId',
  ], 'ConversationRef');
  exactKeys(value.endpoint as unknown as Record<string, unknown>, ['adapter', 'id'], 'EndpointRef');
  canonicalText(value.endpoint.adapter, 'conversation.endpoint.adapter');
  canonicalText(value.endpoint.id, 'conversation.endpoint.id');
  if (value.kind !== 'private' && value.kind !== 'group' && value.kind !== 'channel') {
    throw new Error('conversation.kind is invalid');
  }
  canonicalText(value.id, 'conversation.id');
  if (value.parent) {
    exactKeys(value.parent as unknown as Record<string, unknown>, ['kind', 'id'], 'Conversation parent');
    if (value.parent.kind !== 'private' && value.parent.kind !== 'group' && value.parent.kind !== 'channel') {
      throw new Error('conversation.parent.kind is invalid');
    }
    canonicalText(value.parent.id, 'conversation.parent.id');
  }
  if (value.threadId !== undefined) canonicalText(value.threadId, 'conversation.threadId');
}

function canonicalText(value: unknown, field: string): string {
  const normalized = text(value, field);
  if (value !== normalized) throw new Error(`${field} must be canonical text`);
  return normalized;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${field} must be a canonical SHA-256 digest`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${field} must be a positive integer`);
}

function nonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${field} must be a non-negative integer`);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allow = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !allow.has(key));
  if (unknown.length > 0) throw new Error(`${field} has unknown fields: ${unknown.join(', ')}`);
}
