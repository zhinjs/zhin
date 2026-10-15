import {
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../canonical-value.js';
import type {
  WorkroomProjectionBinding,
  WorkroomProjectionCapture,
  WorkroomProjectionConversation,
  WorkroomProjectionDeliveryResult,
  WorkroomProjectionDeliveryState,
  WorkroomProjectionMessageIndexEntry,
  WorkroomProjectionMessageRef,
  WorkroomProjectionOutboxItem,
  WorkroomProjectionReplyTargetDecision,
  WorkroomProjectionReplyTargetInput,
  WorkroomProjectionState,
} from './contracts.js';
import {
  assertExactRecordKeys,
  assertProjectionItem,
  freezeAndValidateBinding,
  projectionAudience,
  requireConversation,
  requireFiniteNumber,
  requirePositiveInteger,
  requireRecord,
  requireSequence,
  requireText,
  workroomProjectionBindingKey,
} from './projector.js';

export function emptyProjectionState(): WorkroomProjectionState {
  return deepFreeze({ revision: 0, bindings: {}, cursors: {}, items: {}, messageIndex: {} });
}

export function projectionSnapshotName(revision: number): string {
  return `projection.${String(revision).padStart(16, '0')}.json`;
}

export function parseProjectionState(value: unknown, expectedRevision: number): WorkroomProjectionState {
  const snapshot = requireRecord(value, 'snapshot');
  assertExactRecordKeys(snapshot, ['state', 'digest'], 'snapshot');
  const state = requireRecord(snapshot.state, 'snapshot.state');
  if (typeof snapshot.digest !== 'string' || digest(state) !== snapshot.digest) {
    throw new Error('Workroom Projection snapshot digest mismatch');
  }
  assertExactRecordKeys(
    state,
    ['revision', 'bindings', 'cursors', 'items', 'messageIndex'],
    'snapshot.state',
  );
  if (state.revision !== expectedRevision) {
    throw new Error('Workroom Projection snapshot revision mismatch');
  }
  const bindings = requireRecord(state.bindings, 'snapshot.bindings');
  const cursors = requireRecord(state.cursors, 'snapshot.cursors');
  const items = requireRecord(state.items, 'snapshot.items');
  const messageIndex = requireRecord(state.messageIndex, 'snapshot.messageIndex');
  for (const [bindingKey, bindingValue] of Object.entries(bindings)) {
    const binding = freezeAndValidateBinding(bindingValue as WorkroomProjectionBinding);
    if (workroomProjectionBindingKey(binding.projectId, projectionAudience(binding)) !== bindingKey) {
      throw new Error('Workroom Projection binding key mismatch');
    }
  }
  for (const [runId, cursor] of Object.entries(cursors)) {
    requireText(runId, 'snapshot cursor runId');
    requireSequence(cursor, 'snapshot cursor', 0);
  }
  for (const [itemId, itemValue] of Object.entries(items)) {
    const item = itemValue as WorkroomProjectionOutboxItem;
    if (item?.id !== itemId) throw new Error('Workroom Projection snapshot item key mismatch');
    const cursorId = item.cursorId;
    assertProjectionItem(item, cursorId, -1, Number.MAX_SAFE_INTEGER);
    assertDeliveryState(item.delivery, item.conversation);
    const cursor = cursors[cursorId];
    if (typeof cursor !== 'number' || cursor < item.sourceSequence) {
      throw new Error('Workroom Projection snapshot item exceeds durable cursor');
    }
  }
  for (const [key, entryValue] of Object.entries(messageIndex)) {
    const entry = entryValue as WorkroomProjectionMessageIndexEntry;
    const item = items[entry?.projectionId] as WorkroomProjectionOutboxItem | undefined;
    if (!item
      || workroomProjectionMessageKey(entry.message) !== key
      || item.delivery.status !== 'sent'
      || !item.delivery.message
      || workroomProjectionMessageKey(item.delivery.message) !== key
      || entry.bindingRevision !== item.bindingRevision
      || digest(entry.sourceEventIds) !== digest(item.sourceEventIds)
      || digest(entry.target) !== digest(item.target)
      || digest(entry.speaker) !== digest(item.speaker)) {
      throw new Error('Workroom Projection Message Index entry is invalid');
    }
  }
  return deepFreeze({
    revision: expectedRevision,
    bindings: { ...bindings },
    cursors: { ...cursors },
    items: { ...items },
    messageIndex: { ...messageIndex },
  }) as WorkroomProjectionState;
}

export function applyBinding(
  state: WorkroomProjectionState,
  value: WorkroomProjectionBinding,
): WorkroomProjectionState {
  const binding = freezeAndValidateBinding(value);
  const key = workroomProjectionBindingKey(binding.projectId, projectionAudience(binding));
  const current = state.bindings[key];
  if (current && digest(current) === digest(binding)) return state;
  if (current && binding.bindingRevision <= current.bindingRevision) {
    throw new Error('Workroom Projection binding revision must advance');
  }
  return deepFreeze({
    ...state,
    revision: state.revision + 1,
    bindings: { ...state.bindings, [key]: binding },
  });
}

export function applyClaim(
  state: WorkroomProjectionState,
  workerId: string,
  now: number,
  leaseMs: number,
): Readonly<{ state: WorkroomProjectionState; item: WorkroomProjectionOutboxItem }> | undefined {
  requireText(workerId, 'claim.workerId');
  requireFiniteNumber(now, 'claim.now');
  requirePositiveInteger(leaseMs, 'claim.leaseMs');
  const current = Object.values(state.items)
    .filter(item => item.delivery.status === 'pending'
      || (item.delivery.status === 'failed' && item.delivery.retryable === true
        && (item.delivery.nextAttemptAt === undefined || item.delivery.nextAttemptAt <= now))
      || (item.delivery.status === 'leased'
        && Number(item.delivery.leaseExpiresAt) <= now))
    .sort((left, right) => left.sourceSequence - right.sourceSequence || compareCanonicalWorkroomText(left.id, right.id))[0];
  if (!current) return undefined;
  const item = deepFreeze({
    ...current,
    delivery: {
      status: 'leased' as const,
      attempts: current.delivery.attempts + 1,
      fence: current.delivery.fence + 1,
      leaseOwner: workerId,
      leaseExpiresAt: now + leaseMs,
    },
  });
  return deepFreeze({
    item,
    state: {
      ...state,
      revision: state.revision + 1,
      items: { ...state.items, [item.id]: item },
    },
  });
}

export function applySettlement(
  state: WorkroomProjectionState,
  itemId: string,
  workerId: string,
  fence: number,
  resultValue: WorkroomProjectionDeliveryResult,
  settledAt: number,
): WorkroomProjectionState {
  requireFiniteNumber(settledAt, 'delivery settledAt');
  const current = state.items[itemId];
  if (!current
    || current.delivery.status !== 'leased'
    || current.delivery.leaseOwner !== workerId
    || current.delivery.fence !== fence) {
    throw new Error('Workroom Projection delivery settlement is stale or not owned');
  }
  const result = normalizeDeliveryResult(resultValue);
  const delivery: WorkroomProjectionDeliveryState = result.status === 'sent'
    ? {
        status: 'sent',
        attempts: current.delivery.attempts,
        fence: current.delivery.fence,
        ...(result.message ? { message: result.message } : {}),
      }
    : {
        status: 'failed',
        attempts: current.delivery.attempts,
        fence: current.delivery.fence,
        failureCode: result.code,
        retryable: result.retryable,
        ...(result.retryable ? { nextAttemptAt: settledAt + retryDelay(current.delivery.attempts) } : {}),
      };
  const item = deepFreeze({ ...current, delivery });
  let messageIndex = state.messageIndex;
  if (result.status === 'sent' && result.message) {
    if (digest(result.message.conversation) !== digest(current.conversation)) {
      throw new Error('Workroom Projection receipt targets another conversation');
    }
    const key = workroomProjectionMessageKey(result.message);
    const entry = deepFreeze({
      projectionId: current.id,
      bindingRevision: current.bindingRevision,
      sourceEventIds: current.sourceEventIds,
      target: current.target,
      speaker: current.speaker,
      message: result.message,
    });
    const existing = messageIndex[key];
    if (existing && digest(existing) !== digest(entry)) {
      throw new Error('Workroom Projection Message Index conflict');
    }
    messageIndex = { ...messageIndex, [key]: entry };
  }
  return deepFreeze({
    ...state,
    revision: state.revision + 1,
    items: { ...state.items, [itemId]: item },
    messageIndex,
  });
}

export function normalizeDeliveryResult(value: WorkroomProjectionDeliveryResult): WorkroomProjectionDeliveryResult {
  if (value?.status === 'failed') {
    requireText(value.code, 'delivery failure code');
    if (typeof value.retryable !== 'boolean') {
      throw new Error('Workroom Projection delivery retryable must be boolean');
    }
    return deepFreeze({ status: 'failed', code: value.code, retryable: value.retryable });
  }
  if (value?.status !== 'sent') throw new Error('Workroom Projection delivery result is invalid');
  if (!value.message) return Object.freeze({ status: 'sent' });
  requireConversation(value.message.conversation);
  requireText(value.message.id, 'delivery message.id');
  return deepFreeze({ status: 'sent', message: value.message });
}

function assertDeliveryState(
  value: WorkroomProjectionDeliveryState,
  conversation: WorkroomProjectionConversation,
): void {
  const delivery = requireRecord(value, 'delivery state');
  if (!Number.isSafeInteger(delivery.attempts) || Number(delivery.attempts) < 0
    || !Number.isSafeInteger(delivery.fence) || Number(delivery.fence) < 0
    || delivery.attempts !== delivery.fence) {
    throw new Error('Workroom Projection delivery attempt/fence is invalid');
  }
  if (delivery.status === 'pending') {
    assertExactRecordKeys(delivery, ['status', 'attempts', 'fence'], 'pending delivery');
    if (delivery.attempts !== 0) throw new Error('Workroom Projection pending delivery was attempted');
    return;
  }
  if (delivery.status === 'leased') {
    assertExactRecordKeys(
      delivery,
      ['status', 'attempts', 'fence', 'leaseOwner', 'leaseExpiresAt'],
      'leased delivery',
    );
    requireText(delivery.leaseOwner, 'delivery.leaseOwner');
    requireFiniteNumber(delivery.leaseExpiresAt, 'delivery.leaseExpiresAt');
    return;
  }
  if (delivery.status === 'failed') {
    assertExactRecordKeys(
      delivery,
      ['status', 'attempts', 'fence', 'failureCode', 'retryable',
        ...(delivery.nextAttemptAt !== undefined ? ['nextAttemptAt'] : [])],
      'failed delivery',
    );
    requireText(delivery.failureCode, 'delivery.failureCode');
    if (typeof delivery.retryable !== 'boolean') {
      throw new Error('Workroom Projection failed delivery retryable is invalid');
    }
    if (delivery.nextAttemptAt !== undefined) {
      if (delivery.retryable !== true) {
        throw new Error('Workroom Projection non-retryable delivery cannot have nextAttemptAt');
      }
      requireFiniteNumber(delivery.nextAttemptAt, 'delivery.nextAttemptAt');
    }
    return;
  }
  if (delivery.status !== 'sent') {
    throw new Error('Workroom Projection delivery status is invalid');
  }
  assertExactRecordKeys(
    delivery,
    ['status', 'attempts', 'fence', ...(delivery.message ? ['message'] : [])],
    'sent delivery',
  );
  if (delivery.message) {
    const message = delivery.message as WorkroomProjectionMessageRef;
    workroomProjectionMessageKey(message);
    if (digest(message.conversation) !== digest(conversation)) {
      throw new Error('Workroom Projection persisted receipt targets another conversation');
    }
  }
}

function retryDelay(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(6, Math.max(0, attempts - 1)));
}

export function workroomProjectionMessageKey(value: WorkroomProjectionMessageRef): string {
  if (!value) throw new Error('Workroom Projection MessageRef is required');
  requireConversation(value.conversation);
  requireText(value.id, 'message.id');
  return [
    value.conversation.endpoint.adapter,
    value.conversation.endpoint.id,
    value.conversation.kind,
    value.conversation.id,
    value.conversation.parent?.kind ?? '',
    value.conversation.parent?.id ?? '',
    value.conversation.threadId ?? '',
    value.id,
  ].join('\0');
}

/** Pure Message Index lookup; it proposes context and owns no Kernel command port. */
export function resolveProjectionReplyTarget(
  state: WorkroomProjectionState,
  input: WorkroomProjectionReplyTargetInput,
): WorkroomProjectionReplyTargetDecision {
  requireText(input.projectId, 'reply projectId');
  requirePositiveInteger(input.bindingRevision, 'reply bindingRevision');
  const entry = state.messageIndex[workroomProjectionMessageKey(input.replyTo)];
  if (!entry) {
    return deepFreeze({
      status: 'clarification_required',
      reason: 'target_not_found',
      candidateRefs: [],
    });
  }
  if (entry.target.projectId !== input.projectId) {
    return deepFreeze({
      status: 'clarification_required',
      reason: 'cross_project_target',
      candidateRefs: [entry.target.projectId],
    });
  }
  if (input.bindingRevision !== entry.bindingRevision) {
    return deepFreeze({
      status: 'clarification_required',
      reason: 'stale_binding',
      candidateRefs: [entry.projectionId],
    });
  }
  const target = entry.target;
  if (!target.taskKey || !target.taskRevision
    || !target.assignmentId || !target.assignmentRevision) {
    return deepFreeze({
      status: 'clarification_required',
      reason: 'non_task_projection',
      candidateRefs: [entry.projectionId],
    });
  }
  const active = input.activeAssignments.some(candidate =>
    candidate.projectId === target.projectId
    && candidate.runId === target.runId
    && candidate.taskKey === target.taskKey
    && candidate.taskRevision === target.taskRevision
    && candidate.assignmentId === target.assignmentId
    && candidate.assignmentRevision === target.assignmentRevision);
  return deepFreeze({
    status: 'task_target',
    via: 'reply',
    disposition: input.intent === 'task_input' && active
      ? 'context_proposal'
      : 'discussion_only',
    sourceProjectionId: entry.projectionId,
    sourceEventIds: entry.sourceEventIds,
    target: {
      projectId: target.projectId,
      runId: target.runId,
      taskKey: target.taskKey,
      taskRevision: target.taskRevision,
      assignmentId: target.assignmentId,
      assignmentRevision: target.assignmentRevision,
      agentDefinitionId: target.agentDefinitionId,
      status: active ? 'active' : 'historical',
    },
  });
}

export function applyCapture(
  state: WorkroomProjectionState,
  input: WorkroomProjectionCapture,
): WorkroomProjectionState {
  requireText(input.runId, 'capture.runId');
  requireSequence(input.expectedCursor, 'capture.expectedCursor', -1);
  requireSequence(input.cursor, 'capture.cursor', 0);
  const currentCursor = state.cursors[input.runId] ?? -1;
  if (currentCursor !== input.expectedCursor) {
    throw new Error(`Workroom Projection cursor conflict for ${input.runId}`);
  }
  if (input.cursor <= input.expectedCursor) {
    throw new Error('Workroom Projection capture cursor must advance');
  }
  const items = { ...state.items };
  for (const item of input.items) {
    assertProjectionItem(item, input.runId, input.expectedCursor, input.cursor);
    const existing = items[item.id];
    if (existing && existing.digest !== item.digest) {
      throw new Error(`Workroom Projection item conflict: ${item.id}`);
    }
    items[item.id] = item;
  }
  return deepFreeze({
    revision: state.revision + 1,
    bindings: state.bindings,
    cursors: { ...state.cursors, [input.runId]: input.cursor },
    items,
    messageIndex: state.messageIndex,
  });
}


export function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code;
}
