import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';

export type WorkroomEffectOutcome = 'committed' | 'failed' | 'outcome_unknown';
export type WorkroomEffectStatus =
  | 'pending_authorization'
  | 'executing'
  | 'committed'
  | 'failed'
  | 'outcome_unknown'
  | 'cancelled';

export interface WorkroomEffectIntentInput {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly candidateHash: string;
  readonly capability: Readonly<{ ref: string; digest: string }>;
  readonly operation:
    | Readonly<{
        kind: 'git_push';
        parameters: { repositoryId: string; ref: string; headSha: string; changedPaths: readonly string[] };
      }>
    | Readonly<{ kind: 'git_open_pr'; parameters: { repositoryId: string; headRef: string; baseRef: string; headSha: string } }>
    | Readonly<{ kind: 'git_cancel_remote'; parameters: { repositoryId: string; remoteOperationId: string } }>
    | Readonly<{ kind: 'processor_recall'; parameters: {
        purgeId: string;
        objectId: string;
        locationId: string;
        locationAuthorityDigest: string;
        locationManifestDigest: string;
        attempt: number;
        fence: number;
        requestDigest: string;
      } }>
    | Readonly<{ kind: 'compensation'; parameters: { originalEffectId: string; operation: string; receiptRef: string } }>;
  readonly target: Readonly<{ ref: string; digest: string }>;
  readonly preconditions: readonly Readonly<{ ref: string; digest: string }>[];
  readonly risk: Readonly<{
    assessmentRef: string;
    assessmentDigest: string;
    tier: 'low' | 'medium' | 'high' | 'critical';
  }>;
  readonly reversibility:
    | Readonly<{ kind: 'discard_only' | 'irreversible' }>
    | Readonly<{
        kind: 'compensatable';
        compensation: Readonly<{ operation: string; requiresReceipt: true }>;
      }>;
  readonly idempotencyKey: string;
  readonly createdAt: number;
}

export interface WorkroomEffectIntent extends WorkroomEffectIntentInput {
  readonly version: 1;
  readonly id: string;
  readonly digest: string;
}

export interface WorkroomEffectAuthorization {
  readonly version: 1;
  readonly authorized: true;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly candidateHash: string;
  readonly authorizationId: string;
  readonly authorizationDigest: string;
  readonly policy: Readonly<{ id: string; revision: number; digest: string }>;
  readonly authorizedBy: string;
  readonly expiresAt: number;
}

export interface WorkroomEffectAuthorizationPort {
  authorize(input: Readonly<{
    projectId: string;
    expectedSequence: number;
    now: number;
    intent: WorkroomEffectIntent;
  }>): Promise<WorkroomEffectAuthorization>;
}

export interface WorkroomEffectAttempt {
  readonly id: string;
  readonly operationId: string;
  readonly workerId: string;
  readonly fence: number;
  readonly startedAt: number;
  readonly idempotencyKey: string;
  readonly intentDigest: string;
  readonly authorizationDigest: string;
}

export interface WorkroomEffectGatewayReceipt {
  readonly version: 1;
  readonly receiptId: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly authorizationDigest: string;
  readonly attemptId: string;
  readonly fence: number;
  readonly provider: Readonly<{ id: string; digest: string }>;
  readonly outcome: WorkroomEffectOutcome;
  readonly remoteRef: string;
  readonly remoteDigest: string;
  readonly observedAt: number;
  readonly authenticatedBy: string;
}

export interface WorkroomEffectState {
  readonly projectId: string;
  readonly sequence: number;
  readonly status: WorkroomEffectStatus;
  readonly intent: WorkroomEffectIntent;
  readonly authorization?: WorkroomEffectAuthorization;
  readonly attempt?: WorkroomEffectAttempt;
  readonly receipt?: WorkroomEffectGatewayReceipt;
  readonly cancelledAt?: number;
}

export type WorkroomEffectEventType =
  | 'effect.intent_recorded'
  | 'effect.attempt_started'
  | 'effect.receipt_recorded'
  | 'effect.cancelled';

export interface WorkroomEffectEventDraft {
  readonly type: WorkroomEffectEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WorkroomEffectEvent extends WorkroomEffectEventDraft {
  readonly version: 1;
  readonly projectId: string;
  readonly sequence: number;
  readonly digest: string;
}

export interface WorkroomEffectJournal {
  read(projectId: string): Promise<readonly WorkroomEffectEvent[]>;
  append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEffectEventDraft[],
  ): Promise<readonly WorkroomEffectEvent[]>;
}

export class WorkroomEffectSequenceConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`Workroom Effect Ledger sequence conflict: expected ${expected}, actual ${actual}`);
    this.name = 'WorkroomEffectSequenceConflictError';
  }
}

export class MemoryWorkroomEffectJournal implements WorkroomEffectJournal {
  readonly #projects = new Map<string, readonly WorkroomEffectEvent[]>();

  async read(projectId: string): Promise<readonly WorkroomEffectEvent[]> {
    return this.#projects.get(required(projectId, 'projectId')) ?? Object.freeze([]);
  }

  async append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly WorkroomEffectEventDraft[],
  ): Promise<readonly WorkroomEffectEvent[]> {
    const current = await this.read(projectId);
    const actual = current.length - 1;
    if (actual !== expectedSequence) throw new WorkroomEffectSequenceConflictError(expectedSequence, actual);
    const appended = drafts.map((draft, index) => createWorkroomEffectEvent(
      projectId,
      expectedSequence + index + 1,
      draft,
    ));
    const next = Object.freeze([...current, ...appended]);
    replayWorkroomEffectLedger(projectId, next);
    this.#projects.set(projectId, next);
    return appended;
  }
}

export function createWorkroomEffectIntent(input: WorkroomEffectIntentInput): WorkroomEffectIntent {
  const body = normalizeIntent(input);
  const intentDigest = digest(body);
  return deepFreeze({
    ...body,
    id: `effect:${intentDigest}`,
    digest: intentDigest,
  });
}

export class WorkroomEffectLedger {
  constructor(
    readonly journal: WorkroomEffectJournal,
    readonly authorization?: WorkroomEffectAuthorizationPort,
  ) {}

  async recordIntent(projectId: string, intent: WorkroomEffectIntent): Promise<WorkroomEffectState> {
    const canonical = assertIntent(intent);
    if (canonical.projectId !== projectId) throw new Error('Workroom Effect Project binding drift');
    const events = await this.journal.read(projectId);
    const states = replayWorkroomEffectLedger(projectId, events);
    const existing = states[canonical.id];
    if (existing) {
      if (canonicalWorkroomJson(existing.intent) !== canonicalWorkroomJson(canonical)) {
        throw new Error('Workroom Effect Intent identity drift');
      }
      return existing;
    }
    await this.journal.append(projectId, events.length - 1, [{
      type: 'effect.intent_recorded', payload: { intent: canonical },
    }]);
    return await this.read(projectId, canonical.id);
  }

  async startAuthorizedAttempt(
    projectId: string,
    effectId: string,
    input: Readonly<{ operationId: string; workerId: string; fence: number; startedAt: number }>,
  ): Promise<WorkroomEffectState> {
    const events = await this.journal.read(projectId);
    const state = requireState(replayWorkroomEffectLedger(projectId, events), effectId);
    if (state.status === 'outcome_unknown') {
      throw new Error('Workroom Effect outcome requires reconciliation before another attempt');
    }
    if (state.status !== 'pending_authorization') {
      if (state.attempt?.operationId === input.operationId) return state;
      throw new Error(`Workroom Effect cannot start from ${state.status}`);
    }
    if (!this.authorization) throw new Error('Trusted Workroom Effect Authorization Port is unavailable');
    const authorization = await this.authorization.authorize({
      projectId,
      expectedSequence: events.length - 1,
      now: input.startedAt,
      intent: state.intent,
    });
    assertAuthorization(authorization, state.intent, input.startedAt);
    const attempt = createAttempt(input, state.intent, authorization);
    // Authorization and the externally-visible attempt are one durable fact. A
    // crash must never leave an authorization-only state that can be replayed
    // into a second operation.
    await this.journal.append(projectId, events.length - 1, [{
      type: 'effect.attempt_started', payload: { effectId, authorization, attempt },
    }]);
    return await this.read(projectId, effectId);
  }

  async recordReceipt(
    projectId: string,
    effectId: string,
    receipt: WorkroomEffectGatewayReceipt,
  ): Promise<WorkroomEffectState> {
    const events = await this.journal.read(projectId);
    const state = requireState(replayWorkroomEffectLedger(projectId, events), effectId);
    if (state.receipt?.receiptId === receipt.receiptId) {
      if (canonicalWorkroomJson(state.receipt) !== canonicalWorkroomJson(receipt)) {
        throw new Error('Workroom Effect receipt identity drift');
      }
      return state;
    }
    if (state.status !== 'executing' && state.status !== 'outcome_unknown') {
      throw new Error(`Workroom Effect cannot record receipt from ${state.status}`);
    }
    assertGatewayReceipt(receipt, state);
    await this.journal.append(projectId, events.length - 1, [{
      type: 'effect.receipt_recorded', payload: { effectId, receipt: deepFreeze(receipt) },
    }]);
    return await this.read(projectId, effectId);
  }

  async cancelPending(
    projectId: string,
    effectId: string,
    operationId: string,
    cancelledAt: number,
  ): Promise<WorkroomEffectState> {
    const events = await this.journal.read(projectId);
    const state = requireState(replayWorkroomEffectLedger(projectId, events), effectId);
    if (state.status !== 'pending_authorization') {
      throw new Error('Workroom Effect already started and cannot be cancelled as unexecuted');
    }
    await this.journal.append(projectId, events.length - 1, [{
      type: 'effect.cancelled', payload: {
        effectId, operationId: required(operationId, 'cancel operationId'),
        cancelledAt: nonNegative(cancelledAt, 'cancelledAt'),
      },
    }]);
    return await this.read(projectId, effectId);
  }

  async read(projectId: string, effectId: string): Promise<WorkroomEffectState> {
    return requireState(
      replayWorkroomEffectLedger(projectId, await this.journal.read(projectId)),
      effectId,
    );
  }
}

export function replayWorkroomEffectLedger(
  projectId: string,
  events: readonly WorkroomEffectEvent[],
): Readonly<Record<string, WorkroomEffectState>> {
  const states: Record<string, WorkroomEffectState> = {};
  events.forEach((event, sequence) => {
    assertWorkroomEffectEvent(event, projectId, sequence);
    if (event.type === 'effect.intent_recorded') {
      const intent = assertIntent(event.payload.intent as WorkroomEffectIntent);
      if (states[intent.id]) throw new Error(`Duplicate Workroom Effect Intent ${intent.id}`);
      states[intent.id] = deepFreeze({
        projectId, sequence, status: 'pending_authorization', intent,
      });
      return;
    }
    const effectId = required(event.payload.effectId, 'effectId');
    const current = states[effectId];
    if (!current) throw new Error(`Workroom Effect ${effectId} is absent`);
    if (event.type === 'effect.attempt_started') {
      if (current.status !== 'pending_authorization') {
        throw new Error('Effect attempt started without authorization');
      }
      const authorization = event.payload.authorization as WorkroomEffectAuthorization;
      const attempt = event.payload.attempt as WorkroomEffectAttempt;
      assertAuthorization(authorization, current.intent, attempt.startedAt);
      const authorizedState = deepFreeze({ ...current, authorization });
      assertAttempt(attempt, authorizedState);
      states[effectId] = deepFreeze({ ...authorizedState, sequence, status: 'executing', attempt });
      return;
    }
    if (event.type === 'effect.receipt_recorded') {
      if (current.status !== 'executing' && current.status !== 'outcome_unknown') {
        throw new Error('Effect receipt state drift');
      }
      const receipt = event.payload.receipt as WorkroomEffectGatewayReceipt;
      assertGatewayReceipt(receipt, current);
      states[effectId] = deepFreeze({
        ...current, sequence, status: receipt.outcome, receipt,
      });
      return;
    }
    if (current.status !== 'pending_authorization') throw new Error('Effect cancellation state drift');
    required(event.payload.operationId, 'cancel operationId');
    states[effectId] = deepFreeze({
      ...current, sequence, status: 'cancelled',
      cancelledAt: nonNegative(event.payload.cancelledAt, 'cancelledAt'),
    });
  });
  return deepFreeze(states);
}

function normalizeIntent(input: WorkroomEffectIntentInput) {
  required(input.projectId, 'projectId');
  required(input.runId, 'runId');
  required(input.taskKey, 'taskKey');
  positive(input.taskRevision, 'taskRevision');
  requiredDigest(input.candidateHash, 'candidateHash');
  const operation = normalizeOperation(input.operation);
  const reversibility = normalizeReversibility(input.reversibility);
  const body = deepFreeze({
    version: 1 as const,
    projectId: input.projectId,
    runId: input.runId,
    taskKey: input.taskKey,
    taskRevision: input.taskRevision,
    candidateHash: input.candidateHash,
    capability: reference(input.capability, 'capability'),
    operation,
    target: reference(input.target, 'target'),
    preconditions: Object.freeze(input.preconditions.map(item => reference(item, 'precondition'))),
    risk: deepFreeze({
      assessmentRef: required(input.risk.assessmentRef, 'risk assessmentRef'),
      assessmentDigest: requiredDigest(input.risk.assessmentDigest, 'risk assessmentDigest'),
      tier: enumValue(input.risk.tier, ['low', 'medium', 'high', 'critical'], 'risk tier'),
    }),
    reversibility,
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    createdAt: nonNegative(input.createdAt, 'createdAt'),
  });
  rejectForbiddenKeys(body);
  return body;
}

function normalizeOperation(operation: WorkroomEffectIntentInput['operation']) {
  if (operation.kind === 'git_push') {
    assertParameterKeys(operation.parameters, ['repositoryId', 'ref', 'headSha', 'changedPaths']);
    if (!Array.isArray(operation.parameters.changedPaths) || operation.parameters.changedPaths.length === 0) {
      throw new Error('Git push Effect requires changed paths');
    }
    return deepFreeze({
      kind: operation.kind,
      parameters: deepFreeze({
      repositoryId: required(operation.parameters.repositoryId, 'repositoryId'),
      ref: required(operation.parameters.ref, 'ref'),
      headSha: gitSha(operation.parameters.headSha, 'headSha'),
      changedPaths: Object.freeze(operation.parameters.changedPaths.map(path => required(path, 'changed path')).sort()),
      }),
    });
  }
  if (operation.kind === 'git_open_pr') {
    assertParameterKeys(operation.parameters, ['repositoryId', 'headRef', 'baseRef', 'headSha']);
    return deepFreeze({
      kind: operation.kind,
      parameters: deepFreeze({
      repositoryId: required(operation.parameters.repositoryId, 'repositoryId'),
      headRef: required(operation.parameters.headRef, 'headRef'),
      baseRef: required(operation.parameters.baseRef, 'baseRef'),
      headSha: gitSha(operation.parameters.headSha, 'headSha'),
      }),
    });
  }
  if (operation.kind === 'git_cancel_remote') {
    assertParameterKeys(operation.parameters, ['repositoryId', 'remoteOperationId']);
    return deepFreeze({
      kind: operation.kind,
      parameters: deepFreeze({
      repositoryId: required(operation.parameters.repositoryId, 'repositoryId'),
      remoteOperationId: required(operation.parameters.remoteOperationId, 'remoteOperationId'),
      }),
    });
  }
  if (operation.kind === 'processor_recall') {
    assertParameterKeys(operation.parameters, [
      'purgeId', 'objectId', 'locationId', 'locationAuthorityDigest',
      'locationManifestDigest', 'attempt', 'fence', 'requestDigest',
    ]);
    return deepFreeze({
      kind: operation.kind,
      parameters: deepFreeze({
        purgeId: required(operation.parameters.purgeId, 'purgeId'),
        objectId: required(operation.parameters.objectId, 'objectId'),
        locationId: required(operation.parameters.locationId, 'locationId'),
        locationAuthorityDigest: requiredDigest(
          operation.parameters.locationAuthorityDigest, 'locationAuthorityDigest',
        ),
        locationManifestDigest: requiredDigest(
          operation.parameters.locationManifestDigest, 'locationManifestDigest',
        ),
        attempt: positive(operation.parameters.attempt, 'processor recall attempt'),
        fence: positive(operation.parameters.fence, 'processor recall fence'),
        requestDigest: requiredDigest(operation.parameters.requestDigest, 'processor recall requestDigest'),
      }),
    });
  }
  if (operation.kind === 'compensation') {
    assertParameterKeys(operation.parameters, ['originalEffectId', 'operation', 'receiptRef']);
    return deepFreeze({
      kind: operation.kind,
      parameters: deepFreeze({
      originalEffectId: required(operation.parameters.originalEffectId, 'originalEffectId'),
      operation: required(operation.parameters.operation, 'compensation operation'),
      receiptRef: required(operation.parameters.receiptRef, 'receiptRef'),
      }),
    });
  }
  throw new Error('Workroom Effect operation kind is invalid');
}

function normalizeReversibility(value: WorkroomEffectIntentInput['reversibility']) {
  if (value.kind === 'compensatable') {
    if (value.compensation?.requiresReceipt !== true) {
      throw new Error('Compensation requires the original Effect receipt');
    }
    return deepFreeze({
      kind: value.kind,
      compensation: deepFreeze({
        operation: required(value.compensation.operation, 'compensation operation'),
        requiresReceipt: true as const,
      }),
    });
  }
  return deepFreeze({ kind: enumValue(value.kind, ['discard_only', 'irreversible'], 'reversibility') });
}

function assertIntent(intent: WorkroomEffectIntent): WorkroomEffectIntent {
  const canonical = createWorkroomEffectIntent(intent);
  if (intent.id !== canonical.id || intent.digest !== canonical.digest
    || canonicalWorkroomJson(intent) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Workroom Effect Intent content address drift');
  }
  return canonical;
}

function createAttempt(
  input: Readonly<{ operationId: string; workerId: string; fence: number; startedAt: number }>,
  intent: WorkroomEffectIntent,
  authorization: WorkroomEffectAuthorization,
): WorkroomEffectAttempt {
  return deepFreeze({
    id: `effect-attempt:${required(input.operationId, 'operationId')}`,
    operationId: input.operationId,
    workerId: required(input.workerId, 'workerId'),
    fence: positive(input.fence, 'fence'),
    startedAt: nonNegative(input.startedAt, 'startedAt'),
    idempotencyKey: intent.idempotencyKey,
    intentDigest: intent.digest,
    authorizationDigest: authorization.authorizationDigest,
  });
}

function assertAuthorization(
  value: WorkroomEffectAuthorization,
  intent: WorkroomEffectIntent,
  now: number,
): void {
  if (value.version !== 1 || value.authorized !== true
    || value.intentId !== intent.id || value.intentDigest !== intent.digest
    || value.candidateHash !== intent.candidateHash) {
    throw new Error('Workroom Effect authorization binding drift');
  }
  required(value.authorizationId, 'authorizationId');
  requiredDigest(value.authorizationDigest, 'authorizationDigest');
  required(value.policy?.id, 'authorization policy id');
  positive(value.policy?.revision, 'authorization policy revision');
  requiredDigest(value.policy?.digest, 'authorization policy digest');
  required(value.authorizedBy, 'authorizedBy');
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now) {
    throw new Error('Workroom Effect authorization is expired');
  }
}

function assertAttempt(attempt: WorkroomEffectAttempt, state: WorkroomEffectState): void {
  if (!state.authorization || attempt.intentDigest !== state.intent.digest
    || attempt.authorizationDigest !== state.authorization.authorizationDigest
    || attempt.idempotencyKey !== state.intent.idempotencyKey) {
    throw new Error('Workroom Effect attempt binding drift');
  }
  positive(attempt.fence, 'attempt fence');
  nonNegative(attempt.startedAt, 'attempt startedAt');
}

function assertGatewayReceipt(receipt: WorkroomEffectGatewayReceipt, state: WorkroomEffectState): void {
  if (!state.authorization || !state.attempt
    || receipt.version !== 1
    || receipt.intentId !== state.intent.id
    || receipt.intentDigest !== state.intent.digest
    || receipt.authorizationDigest !== state.authorization.authorizationDigest
    || receipt.attemptId !== state.attempt.id
    || receipt.fence !== state.attempt.fence) {
    throw new Error('Workroom Effect gateway receipt binding drift');
  }
  required(receipt.receiptId, 'receiptId');
  required(receipt.provider?.id, 'provider id');
  requiredDigest(receipt.provider?.digest, 'provider digest');
  enumValue(receipt.outcome, ['committed', 'failed', 'outcome_unknown'], 'Effect outcome');
  required(receipt.remoteRef, 'remoteRef');
  requiredDigest(receipt.remoteDigest, 'remoteDigest');
  nonNegative(receipt.observedAt, 'observedAt');
  required(receipt.authenticatedBy, 'authenticatedBy');
}

export function createWorkroomEffectEvent(
  projectId: string,
  sequence: number,
  draft: WorkroomEffectEventDraft,
): WorkroomEffectEvent {
  const body = deepFreeze({
    version: 1 as const,
    projectId: required(projectId, 'projectId'),
    sequence: nonNegative(sequence, 'sequence'),
    type: draft.type,
    payload: deepFreeze(draft.payload),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export function assertWorkroomEffectEvent(event: WorkroomEffectEvent, projectId: string, sequence: number): void {
  const canonical = createWorkroomEffectEvent(projectId, sequence, event);
  if (event.digest !== canonical.digest
    || canonicalWorkroomJson(event) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Workroom Effect Journal event drift');
  }
  const keysByType: Record<WorkroomEffectEventType, readonly string[]> = {
    'effect.intent_recorded': ['intent'],
    'effect.attempt_started': ['effectId', 'authorization', 'attempt'],
    'effect.receipt_recorded': ['effectId', 'receipt'],
    'effect.cancelled': ['effectId', 'operationId', 'cancelledAt'],
  };
  const keys = keysByType[event.type];
  if (!keys) throw new Error('Workroom Effect Journal event type is invalid');
  assertParameterKeys(event.payload as Record<string, unknown>, keys);
}

function requireState(
  states: Readonly<Record<string, WorkroomEffectState>>,
  effectId: string,
): WorkroomEffectState {
  const state = states[required(effectId, 'effectId')];
  if (!state) throw new Error(`Workroom Effect ${effectId} not found`);
  return state;
}

function reference(value: Readonly<{ ref: string; digest: string }>, label: string) {
  return deepFreeze({
    ref: required(value?.ref, `${label} ref`),
    digest: requiredDigest(value?.digest, `${label} digest`),
  });
}

function assertParameterKeys(input: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(input).sort();
  if (actual.length !== keys.length || keys.some(key => !actual.includes(key))) {
    throw new Error(`Workroom Effect operation contains forbidden field ${actual.find(key => !keys.includes(key)) ?? 'missing'}`);
  }
}

function rejectForbiddenKeys(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(credential|token|password|secret|privatekey|content|body)/iu.test(key)) {
      throw new Error(`Workroom Effect contains forbidden field ${key}`);
    }
    rejectForbiddenKeys(child);
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function gitSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}

function nonNegative(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}
