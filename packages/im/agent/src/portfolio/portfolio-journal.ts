export type PortfolioGrantPreemptibility = 'checkpointable' | 'atomic';

export interface PortfolioWorkRef {
  readonly runId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
}

export interface PortfolioResourceDemand {
  readonly poolId: string;
  readonly capacityUnits: number;
  readonly rateUnits: number;
  readonly budgetUnits: number;
}

export interface PortfolioResourceBundle {
  readonly demands: readonly PortfolioResourceDemand[];
}

/** Content-free resource request published by one Project-local Scheduler. */
export interface PortfolioCapacityRequest {
  readonly requestId: string;
  readonly projectId: string;
  readonly workRef: PortfolioWorkRef;
  readonly schedulerRevision: string;
  readonly schedulerSequence: number;
  readonly localOrder: number;
  readonly projectPolicyRevision: number;
  readonly opaqueHeadId: string;
  readonly payloadDigest: string;
  readonly resourceBundle: PortfolioResourceBundle;
  readonly preemptibility: PortfolioGrantPreemptibility;
  readonly deadlineAt?: number;
  readonly starvationAt: number;
}

export interface PortfolioFactDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'capacity.requested';
  readonly payload: Readonly<{ request: unknown }>;
}

export interface PortfolioFact {
  readonly version: 1;
  readonly portfolioId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: 'capacity.requested';
  readonly payload: Readonly<{ request: PortfolioCapacityRequest }>;
}

export interface PortfolioJournalRepository {
  read(portfolioId: string): Promise<readonly PortfolioFact[]>;
  append(
    portfolioId: string,
    expectedSequence: number,
    drafts: readonly PortfolioFactDraft[],
  ): Promise<readonly PortfolioFact[]>;
}

export class PortfolioSequenceConflictError extends Error {
  constructor(
    readonly portfolioId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(`Portfolio ${portfolioId} sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`);
  }
}

export class PortfolioEventIdentityConflictError extends Error {
  constructor(readonly portfolioId: string, readonly eventId: string) {
    super(`Portfolio ${portfolioId} eventId conflict: ${eventId}`);
  }
}

export class PortfolioRequestIdentityConflictError extends Error {
  constructor(readonly portfolioId: string, readonly identity: string) {
    super(`Portfolio ${portfolioId} Capacity Request identity conflict: ${identity}`);
  }
}

/** In-memory adapter for the Portfolio Journal port; authoritative ordering is CAS-only. */
export class InMemoryPortfolioJournalRepository implements PortfolioJournalRepository {
  readonly #journals = new Map<string, readonly PortfolioFact[]>();

  async read(portfolioId: string): Promise<readonly PortfolioFact[]> {
    identifier(portfolioId, 'portfolioId');
    return this.#journals.get(portfolioId) ?? Object.freeze([]);
  }

  async append(
    portfolioId: string,
    expectedSequence: number,
    drafts: readonly PortfolioFactDraft[],
  ): Promise<readonly PortfolioFact[]> {
    identifier(portfolioId, 'portfolioId');
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < -1) {
      throw new Error('Invalid Portfolio append position');
    }
    const current = this.#journals.get(portfolioId) ?? Object.freeze([]);
    const actualSequence = current.at(-1)?.sequence ?? -1;
    if (drafts.length === 0) {
      if (actualSequence !== expectedSequence) {
        throw new PortfolioSequenceConflictError(portfolioId, expectedSequence, actualSequence);
      }
      return Object.freeze([]);
    }
    const normalized = deduplicateDrafts(
      portfolioId,
      drafts.map((draft) => normalizeDraft(draft)),
    );
    const eventsById = new Map(current.map((event) => [event.eventId, event]));
    const requestsById = new Map(current.map((event) => [event.payload.request.requestId, event]));
    const requestsByHead = new Map(current.map((event) => [headKey(event.payload.request), event]));
    const idempotent = new Set<PortfolioFact>();

    for (const draft of normalized) {
      const existingEvent = eventsById.get(draft.eventId);
      if (existingEvent) {
        if (existingEvent.type !== draft.type
          || stableJson(existingEvent.payload.request) !== stableJson(draft.request)) {
          throw new PortfolioEventIdentityConflictError(portfolioId, draft.eventId);
        }
        idempotent.add(existingEvent);
        continue;
      }
      for (const [identity, existingRequest] of [
        [`requestId:${draft.request.requestId}`, requestsById.get(draft.request.requestId)],
        [`opaqueHeadId:${headKey(draft.request)}`, requestsByHead.get(headKey(draft.request))],
      ] as const) {
        if (!existingRequest) continue;
        throw new PortfolioRequestIdentityConflictError(portfolioId, identity);
      }
    }

    if (idempotent.size > 0) {
      if (idempotent.size !== normalized.length) {
        throw new Error('Portfolio append cannot mix replayed and new facts');
      }
      return Object.freeze([...idempotent].sort((left, right) => left.sequence - right.sequence));
    }
    if (actualSequence !== expectedSequence) {
      throw new PortfolioSequenceConflictError(portfolioId, expectedSequence, actualSequence);
    }

    const appended = normalized.map<PortfolioFact>((draft, index) => deepFreeze({
      version: 1,
      portfolioId,
      sequence: expectedSequence + index + 1,
      eventId: draft.eventId,
      occurredAt: draft.occurredAt,
      type: draft.type,
      payload: { request: draft.request },
    }));
    this.#journals.set(portfolioId, Object.freeze([...current, ...appended]));
    return Object.freeze(appended);
  }
}

const REQUEST_KEYS = new Set([
  'requestId',
  'projectId',
  'workRef',
  'schedulerRevision',
  'schedulerSequence',
  'localOrder',
  'projectPolicyRevision',
  'opaqueHeadId',
  'payloadDigest',
  'resourceBundle',
  'preemptibility',
  'deadlineAt',
  'starvationAt',
]);
const WORK_REF_KEYS = new Set(['runId', 'profileRevisionId', 'profileDigest']);
const RESOURCE_BUNDLE_KEYS = new Set(['demands']);
const RESOURCE_DEMAND_KEYS = new Set(['poolId', 'capacityUnits', 'rateUnits', 'budgetUnits']);

export function parsePortfolioCapacityRequest(value: unknown): PortfolioCapacityRequest {
  const request = exactRecord(value, REQUEST_KEYS, 'Capacity Request');
  const workRef = exactRecord(request.workRef, WORK_REF_KEYS, 'Capacity Request workRef');
  const resourceBundle = exactRecord(
    request.resourceBundle,
    RESOURCE_BUNDLE_KEYS,
    'Capacity Request resourceBundle',
  );
  if (!Array.isArray(resourceBundle.demands) || resourceBundle.demands.length === 0) {
    throw new Error('Capacity Request requires a non-empty atomic Resource Bundle');
  }
  const seenPools = new Set<string>();
  const demands = resourceBundle.demands.map((raw, index): PortfolioResourceDemand => {
    const demand = exactRecord(raw, RESOURCE_DEMAND_KEYS, `Capacity Request demand ${index}`);
    const poolId = identifier(demand.poolId, `resourceBundle.demands[${index}].poolId`);
    if (seenPools.has(poolId)) throw new Error(`Duplicate Resource Pool demand: ${poolId}`);
    seenPools.add(poolId);
    return {
      poolId,
      capacityUnits: positiveSafeInteger(demand.capacityUnits, `${poolId}.capacityUnits`),
      rateUnits: positiveSafeInteger(demand.rateUnits, `${poolId}.rateUnits`),
      budgetUnits: nonNegativeSafeInteger(demand.budgetUnits, `${poolId}.budgetUnits`),
    };
  }).sort((left, right) => left.poolId.localeCompare(right.poolId));

  const preemptibility = request.preemptibility;
  if (preemptibility !== 'checkpointable' && preemptibility !== 'atomic') {
    throw new Error('Invalid Capacity Request preemptibility');
  }
  const deadlineAt = request.deadlineAt === undefined
    ? undefined
    : positiveSafeInteger(request.deadlineAt, 'deadlineAt');
  const starvationAt = positiveSafeInteger(request.starvationAt, 'starvationAt');
  if (deadlineAt !== undefined && starvationAt > deadlineAt) {
    throw new Error('Capacity Request starvationAt cannot exceed deadlineAt');
  }

  return deepFreeze({
    requestId: identifier(request.requestId, 'requestId'),
    projectId: identifier(request.projectId, 'projectId'),
    workRef: {
      runId: identifier(workRef.runId, 'workRef.runId'),
      profileRevisionId: identifier(workRef.profileRevisionId, 'workRef.profileRevisionId'),
      profileDigest: contentDigest(workRef.profileDigest, 'workRef.profileDigest'),
    },
    schedulerRevision: identifier(request.schedulerRevision, 'schedulerRevision'),
    schedulerSequence: nonNegativeSafeInteger(request.schedulerSequence, 'schedulerSequence'),
    localOrder: nonNegativeSafeInteger(request.localOrder, 'localOrder'),
    projectPolicyRevision: positiveSafeInteger(request.projectPolicyRevision, 'projectPolicyRevision'),
    opaqueHeadId: identifier(request.opaqueHeadId, 'opaqueHeadId'),
    payloadDigest: contentDigest(request.payloadDigest, 'payloadDigest'),
    resourceBundle: { demands },
    preemptibility,
    ...(deadlineAt === undefined ? {} : { deadlineAt }),
    starvationAt,
  });
}

type NormalizedPortfolioFactDraft = Readonly<{
  eventId: string;
  occurredAt: number;
  type: 'capacity.requested';
  request: PortfolioCapacityRequest;
}>;

function normalizeDraft(draft: PortfolioFactDraft): NormalizedPortfolioFactDraft {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new Error('Invalid Portfolio fact draft');
  }
  if (draft.type !== 'capacity.requested') throw new Error('Invalid Portfolio fact type');
  if (!Number.isFinite(draft.occurredAt) || draft.occurredAt < 0) {
    throw new Error('Invalid Portfolio fact occurredAt');
  }
  const payload = exactRecord(draft.payload, new Set(['request']), 'Portfolio fact payload');
  return deepFreeze({
    eventId: identifier(draft.eventId, 'eventId'),
    occurredAt: draft.occurredAt,
    type: draft.type,
    request: parsePortfolioCapacityRequest(payload.request),
  });
}

function deduplicateDrafts(
  portfolioId: string,
  drafts: readonly NormalizedPortfolioFactDraft[],
): readonly NormalizedPortfolioFactDraft[] {
  const result: NormalizedPortfolioFactDraft[] = [];
  const byEventId = new Map<string, NormalizedPortfolioFactDraft>();
  const byRequestId = new Map<string, NormalizedPortfolioFactDraft>();
  const byHead = new Map<string, NormalizedPortfolioFactDraft>();
  for (const draft of drafts) {
    const eventMatch = byEventId.get(draft.eventId);
    if (eventMatch) {
      if (stableJson(eventMatch.request) !== stableJson(draft.request)) {
        throw new PortfolioEventIdentityConflictError(portfolioId, draft.eventId);
      }
      continue;
    }
    byEventId.set(draft.eventId, draft);
    const requestMatch = byRequestId.get(draft.request.requestId);
    const headMatch = byHead.get(headKey(draft.request));
    for (const [identity, match] of [
      [`requestId:${draft.request.requestId}`, requestMatch],
      [`opaqueHeadId:${headKey(draft.request)}`, headMatch],
    ] as const) {
      if (match) throw new PortfolioRequestIdentityConflictError(portfolioId, identity);
    }
    byRequestId.set(draft.request.requestId, draft);
    byHead.set(headKey(draft.request), draft);
    result.push(draft);
  }
  return Object.freeze(result);
}

function headKey(request: PortfolioCapacityRequest): string {
  return `${request.projectId}:${request.opaqueHeadId}`;
}

function exactRecord(value: unknown, allowed: ReadonlySet<string>, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) {
    throw new Error(`${label} cannot carry Workroom content or unknown fields: ${unknown.join(', ')}`);
  }
  return record;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error(`Invalid opaque ${path}`);
  }
  return value;
}

function contentDigest(value: unknown, path: string): string {
  const result = identifier(value, path);
  if (!result.startsWith('sha256:')) throw new Error(`Invalid ${path}`);
  return result;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${path} must be a positive safe integer`);
  return Number(value);
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${path} must be a non-negative safe integer`);
  return Number(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
