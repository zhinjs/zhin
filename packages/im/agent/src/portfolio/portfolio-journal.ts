import { compareCanonicalWorkroomText, digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';

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

export type PortfolioLane = 'urgent' | 'high' | 'normal' | 'low';
export type PortfolioProjectStatus = 'active' | 'paused' | 'reclaim_checkpointable';

export interface PortfolioResourcePoolPolicy {
  readonly poolId: string;
  readonly capacityUnits: number;
  readonly rateUnitsPerWindow: number;
  readonly rateWindowTicks: number;
  readonly priceMicrosPerBudgetUnit: number;
}

export interface PortfolioProjectPolicy {
  readonly projectId: string;
  readonly revision: number;
  readonly lane: PortfolioLane;
  readonly weight: number;
  readonly hardBudgetMicros: number;
  readonly allowedPools: readonly string[];
  readonly maxOutstandingRequests: number;
  readonly maxConcurrentGrants: number;
  readonly burstLimit: number;
  readonly starvationTicks: number;
  readonly status: PortfolioProjectStatus;
}

export interface PortfolioPolicySnapshot {
  readonly revision: number;
  readonly digest: string;
  readonly globalBudgetMicros: number;
  readonly offerTtlTicks: number;
  readonly leaseTtlTicks: number;
  readonly leaseHeartbeatTicks: number;
  readonly maxLeaseQuantumTicks: number;
  readonly maxLeaseRenewals: number;
  readonly reclaimTtlTicks: number;
  readonly pools: Readonly<Record<string, PortfolioResourcePoolPolicy>>;
  readonly projects: Readonly<Record<string, PortfolioProjectPolicy>>;
}

export interface PortfolioPriorityOverride {
  readonly overrideId: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly lane: PortfolioLane;
  readonly policyRevision: number;
  readonly requestPayloadDigest: string;
  readonly expiresAt: number;
}

export interface PortfolioGovernanceProof {
  readonly principalId: string;
  readonly authorizedBy: string;
  readonly reasonDigest: string;
  readonly targetDigest: string;
  readonly expectedRevision: number;
}

export interface PortfolioValidatedBundleAuthority {
  readonly requestDigest: string;
  readonly resourceBundleDigest: string;
  readonly catalogGenerationId: string;
  readonly catalogRevision: number;
  readonly catalogDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly profileCeilingDigest: string;
  readonly validatedBundleDigest: string;
  readonly reservedCostMicros: number;
}

/** Exact command proof issued by the owning Workroom Kernel. */
export interface PortfolioKernelCommandAuthority {
  readonly portfolioId: string;
  readonly action: 'consume' | 'assignment_failed' | 'reclaim_acknowledge' | 'renew';
  readonly projectId: string;
  readonly requestId: string;
  readonly grantId: string;
  readonly fence: number;
  readonly assignmentRef: string;
  readonly reclaimId?: string;
  readonly outcome?: 'checkpointed' | 'declined';
  readonly checkpointRef?: string;
  readonly checkpointDigest?: string;
  readonly heartbeatSequence?: number;
  readonly clockSequence?: number;
  readonly clockDigest?: string;
  readonly policyDigest?: string;
  readonly usageSettlementCursor?: number;
  readonly failureReason?: PortfolioGrantAssignmentFailureReason;
  readonly kernelSequence?: number;
  readonly kernelFactDigest?: string;
  readonly commandDigest: string;
  readonly authorizedBy: string;
}

export type PortfolioGrantAssignmentFailureReason =
  | 'task_stale'
  | 'task_terminal'
  | 'run_terminal';

/** Exact receipt proof issued by the configured Usage Gateway. */
export interface PortfolioUsageGatewayAuthority {
  readonly portfolioId: string;
  readonly receiptId: string;
  readonly requestId: string;
  readonly grantId: string;
  readonly fence: number;
  readonly actualCostMicros: number;
  readonly settlementRef: string;
  readonly receiptDigest: string;
  readonly authenticatedBy: string;
}

/** Monotonic time proof issued by the Portfolio Kernel clock. */
export interface PortfolioClockAuthority {
  readonly portfolioId: string;
  readonly now: number;
  readonly clockDigest: string;
  readonly authorizedBy: string;
}

export type PortfolioCapacityGrantStatus =
  | 'offered' | 'consumed' | 'reclaim_requested' | 'usage_pending'
  | 'usage_unknown' | 'settled' | 'expired' | 'assignment_failed';

export interface PortfolioCapacityGrant {
  readonly grantId: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly fence: number;
  readonly resourceBundle: PortfolioResourceBundle;
  readonly requestDigest: string;
  readonly resourceBundleDigest: string;
  readonly catalogGenerationId: string;
  readonly catalogRevision: number;
  readonly catalogDigest: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly profileCeilingDigest: string;
  readonly validatedBundleDigest: string;
  readonly reservedCostMicros: number;
  readonly portfolioPolicyRevision: number;
  readonly portfolioPolicyDigest: string;
  readonly projectPolicyRevision: number;
  readonly lane: PortfolioLane;
  readonly issuedAt: number;
  readonly issuedSequence: number;
  readonly offerExpiresAt: number;
  readonly status: PortfolioCapacityGrantStatus;
  readonly consumedAt?: number;
  readonly leaseExpiresAt?: number;
  readonly assignmentRef?: string;
  readonly actualCostMicros?: number;
  readonly settlementRef?: string;
  readonly receiptId?: string;
  readonly receiptDigest?: string;
  readonly authenticatedBy?: string;
  readonly maxLeaseExpiresAt?: number;
  readonly renewalCount?: number;
  readonly lastHeartbeatSequence?: number;
  readonly lastHeartbeatAt?: number;
}

export interface PortfolioCapacityReclaim {
  readonly reclaimId: string;
  readonly grantId: string;
  readonly projectId: string;
  readonly reservedForRequestId?: string;
  readonly requestedAt: number;
  readonly deadline: number;
  readonly reason: 'higher_portfolio_priority' | 'starvation_bound' | 'project_pause';
  readonly status: 'pending' | 'checkpointed' | 'declined' | 'timed_out';
  readonly checkpointRef?: string;
  readonly checkpointDigest?: string;
}

export interface PortfolioServiceNormalization {
  readonly normalizationId: string;
  readonly divisor: number;
  readonly projectService: Readonly<Record<string, number>>;
}

export interface PortfolioFactPayloadMap {
  readonly 'portfolio.policy_pinned': Readonly<{
    policy: PortfolioPolicySnapshot; governance: PortfolioGovernanceProof;
  }>;
  readonly 'project.policy_updated': Readonly<{
    policy: PortfolioProjectPolicy; governance: PortfolioGovernanceProof;
  }>;
  readonly 'priority.override_set': Readonly<{
    override: PortfolioPriorityOverride; governance: PortfolioGovernanceProof;
  }>;
  readonly 'capacity.requested': Readonly<{
    request: PortfolioCapacityRequest; bundleAuthority?: PortfolioValidatedBundleAuthority;
  }>;
  readonly 'capacity.grant_offered': Readonly<{ grant: PortfolioCapacityGrant }>;
  readonly 'capacity.grant_consumed': Readonly<{
    grantId: string; projectId: string; fence: number; assignmentRef: string;
    consumedAt: number; leaseExpiresAt: number; maxLeaseExpiresAt: number;
    authority: PortfolioKernelCommandAuthority;
  }>;
  readonly 'capacity.grant_assignment_failed': Readonly<{
    grantId: string; projectId: string; fence: number; assignmentRef: string;
    reason: PortfolioGrantAssignmentFailureReason; kernelSequence: number;
    kernelFactDigest: string; failedAt: number; authority: PortfolioKernelCommandAuthority;
  }>;
  readonly 'capacity.grant_lease_renewed': Readonly<{
    grantId: string; projectId: string; fence: number; assignmentRef: string;
    heartbeatSequence: number; renewedAt: number; previousLeaseExpiresAt: number;
    leaseExpiresAt: number; maxLeaseExpiresAt: number; policyDigest: string;
    clockSequence: number; clockDigest: string; usageSettlementCursor: number;
    authority: PortfolioKernelCommandAuthority;
  }>;
  readonly 'capacity.grant_expired': Readonly<{ grantId: string; fence: number }>;
  readonly 'capacity.grant_lease_lost': Readonly<{ grantId: string; fence: number; usage: 'unknown' }>;
  readonly 'capacity.usage_settled': Readonly<{
    receiptId: string; grantId: string; fence: number; actualCostMicros: number;
    settlementRef: string; authenticatedBy: string; authority: PortfolioUsageGatewayAuthority;
  }>;
  readonly 'capacity.reclaim_requested': Readonly<{ reclaim: PortfolioCapacityReclaim }>;
  readonly 'capacity.reclaim_acknowledged': Readonly<{
    reclaimId: string; grantId: string; projectId: string; fence: number;
    outcome: 'checkpointed' | 'declined'; checkpointRef?: string;
    checkpointDigest?: string;
    authority: PortfolioKernelCommandAuthority;
  }>;
  readonly 'capacity.reclaim_timed_out': Readonly<{ reclaimId: string; grantId: string; fence: number }>;
  readonly 'clock.advanced': Readonly<{ now: number; authority: PortfolioClockAuthority }>;
  readonly 'service.normalized': Readonly<{ normalization: PortfolioServiceNormalization }>;
}

export type PortfolioFactType = keyof PortfolioFactPayloadMap;

export interface PortfolioFactDraft {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly type: PortfolioFactType;
  readonly payload: unknown;
}

type PortfolioFactBase = {
  readonly version: 1;
  readonly portfolioId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly occurredAt: number;
};

export type PortfolioFact = {
  [Type in PortfolioFactType]: Readonly<PortfolioFactBase & {
    type: Type;
    payload: PortfolioFactPayloadMap[Type];
  }>
}[PortfolioFactType];

export interface PortfolioJournalRepository {
  listPortfolioIds(): Promise<readonly string[]>;
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

  async listPortfolioIds(): Promise<readonly string[]> {
    return Object.freeze([...this.#journals.keys()].sort());
  }

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
      drafts.map((draft) => parsePortfolioFactDraft(draft)),
    );
    const eventsById = new Map(current.map((event) => [event.eventId, event]));
    const requestEvents = current.filter((event): event is Extract<PortfolioFact, { type: 'capacity.requested' }> =>
      event.type === 'capacity.requested');
    const requestsById = new Map(requestEvents.map((event) => [event.payload.request.requestId, event]));
    const requestsByHead = new Map(requestEvents.map((event) => [headKey(event.payload.request), event]));
    const idempotent = new Set<PortfolioFact>();

    for (const draft of normalized) {
      const existingEvent = eventsById.get(draft.eventId);
      if (existingEvent) {
        if (existingEvent.type !== draft.type
          || stableJson(existingEvent.payload) !== stableJson(draft.payload)) {
          throw new PortfolioEventIdentityConflictError(portfolioId, draft.eventId);
        }
        idempotent.add(existingEvent);
        continue;
      }
      if (draft.type === 'capacity.requested') {
        for (const [identity, existingRequest] of [
          [`requestId:${draft.payload.request.requestId}`, requestsById.get(draft.payload.request.requestId)],
          [`opaqueHeadId:${headKey(draft.payload.request)}`, requestsByHead.get(headKey(draft.payload.request))],
        ] as const) {
          if (!existingRequest) continue;
          throw new PortfolioRequestIdentityConflictError(portfolioId, identity);
        }
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

    const appended = normalized.map((draft, index): PortfolioFact => deepFreeze({
      version: 1,
      portfolioId,
      sequence: expectedSequence + index + 1,
      eventId: draft.eventId,
      occurredAt: draft.occurredAt,
      type: draft.type,
      payload: draft.payload,
    } as PortfolioFact));
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
  const bundle = parsePortfolioResourceBundle(resourceBundle);

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
    resourceBundle: bundle,
    preemptibility,
    ...(deadlineAt === undefined ? {} : { deadlineAt }),
    starvationAt,
  });
}

export function parsePortfolioResourceBundle(value: unknown): PortfolioResourceBundle {
  const resourceBundle = exactRecord(value, RESOURCE_BUNDLE_KEYS, 'Portfolio Resource Bundle');
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
  }).sort((left, right) => compareCanonicalWorkroomText(left.poolId, right.poolId));
  return deepFreeze({ demands });
}

const PORTFOLIO_FACT_TYPES = new Set<PortfolioFactType>([
  'portfolio.policy_pinned', 'project.policy_updated', 'priority.override_set',
  'capacity.requested', 'capacity.grant_offered', 'capacity.grant_consumed',
  'capacity.grant_assignment_failed',
  'capacity.grant_lease_renewed',
  'capacity.grant_expired', 'capacity.grant_lease_lost', 'capacity.usage_settled',
  'capacity.reclaim_requested', 'capacity.reclaim_acknowledged',
  'capacity.reclaim_timed_out', 'clock.advanced', 'service.normalized',
]);

export function parsePortfolioFactPayload<Type extends PortfolioFactType>(
  type: Type,
  value: unknown,
): PortfolioFactPayloadMap[Type] {
  let payload: PortfolioFactPayloadMap[PortfolioFactType];
  switch (type) {
    case 'portfolio.policy_pinned': {
      const record = exactRecord(value, new Set(['policy', 'governance']), type);
      payload = {
        policy: parsePortfolioPolicySnapshot(record.policy),
        governance: parseGovernanceProof(record.governance),
      };
      break;
    }
    case 'project.policy_updated': {
      const record = exactRecord(value, new Set(['policy', 'governance']), type);
      payload = {
        policy: parsePortfolioProjectPolicy(record.policy),
        governance: parseGovernanceProof(record.governance),
      };
      break;
    }
    case 'priority.override_set': {
      const record = exactRecord(value, new Set(['override', 'governance']), type);
      payload = {
        override: parsePriorityOverride(record.override),
        governance: parseGovernanceProof(record.governance),
      };
      break;
    }
    case 'capacity.requested': {
      const record = exactRecord(value, new Set(['request', 'bundleAuthority']), type);
      payload = {
        request: parsePortfolioCapacityRequest(record.request),
        ...(record.bundleAuthority === undefined
          ? {}
          : { bundleAuthority: parseValidatedBundleAuthority(record.bundleAuthority) }),
      };
      break;
    }
    case 'capacity.grant_offered': {
      const record = exactRecord(value, new Set(['grant']), type);
      payload = { grant: parseCapacityGrant(record.grant) };
      break;
    }
    case 'capacity.grant_consumed': {
      const record = exactRecord(value, new Set([
        'grantId', 'projectId', 'fence', 'assignmentRef', 'consumedAt', 'leaseExpiresAt',
        'maxLeaseExpiresAt', 'authority',
      ]), type);
      payload = {
        grantId: identifier(record.grantId, 'grantId'),
        projectId: identifier(record.projectId, 'projectId'),
        fence: positiveSafeInteger(record.fence, 'fence'),
        assignmentRef: identifier(record.assignmentRef, 'assignmentRef'),
        consumedAt: nonNegativeSafeInteger(record.consumedAt, 'consumedAt'),
        leaseExpiresAt: positiveSafeInteger(record.leaseExpiresAt, 'leaseExpiresAt'),
        maxLeaseExpiresAt: positiveSafeInteger(record.maxLeaseExpiresAt, 'maxLeaseExpiresAt'),
        authority: parseKernelCommandAuthority(record.authority),
      };
      if (payload.leaseExpiresAt <= payload.consumedAt
        || payload.maxLeaseExpiresAt < payload.leaseExpiresAt) {
        throw new Error('Capacity Grant lease/max quantum must expire after consume');
      }
      break;
    }
    case 'capacity.grant_assignment_failed': {
      const record = exactRecord(value, new Set([
        'grantId', 'projectId', 'fence', 'assignmentRef', 'reason', 'kernelSequence',
        'kernelFactDigest', 'failedAt', 'authority',
      ]), type);
      if (record.reason !== 'task_stale' && record.reason !== 'task_terminal'
        && record.reason !== 'run_terminal') {
        throw new Error('Invalid Capacity Grant Assignment failure reason');
      }
      payload = {
        grantId: identifier(record.grantId, 'grantId'),
        projectId: identifier(record.projectId, 'projectId'),
        fence: positiveSafeInteger(record.fence, 'fence'),
        assignmentRef: identifier(record.assignmentRef, 'assignmentRef'),
        reason: record.reason,
        kernelSequence: nonNegativeSafeInteger(record.kernelSequence, 'kernelSequence'),
        kernelFactDigest: contentDigest(record.kernelFactDigest, 'kernelFactDigest'),
        failedAt: nonNegativeSafeInteger(record.failedAt, 'failedAt'),
        authority: parseKernelCommandAuthority(record.authority),
      };
      break;
    }
    case 'capacity.grant_lease_renewed': {
      const record = exactRecord(value, new Set([
        'grantId', 'projectId', 'fence', 'assignmentRef', 'heartbeatSequence', 'renewedAt',
        'previousLeaseExpiresAt', 'leaseExpiresAt', 'maxLeaseExpiresAt', 'policyDigest',
        'clockSequence', 'clockDigest', 'usageSettlementCursor', 'authority',
      ]), type);
      payload = {
        grantId: identifier(record.grantId, 'grantId'),
        projectId: identifier(record.projectId, 'projectId'),
        fence: positiveSafeInteger(record.fence, 'fence'),
        assignmentRef: identifier(record.assignmentRef, 'assignmentRef'),
        heartbeatSequence: positiveSafeInteger(record.heartbeatSequence, 'heartbeatSequence'),
        renewedAt: nonNegativeSafeInteger(record.renewedAt, 'renewedAt'),
        previousLeaseExpiresAt: positiveSafeInteger(record.previousLeaseExpiresAt, 'previousLeaseExpiresAt'),
        leaseExpiresAt: positiveSafeInteger(record.leaseExpiresAt, 'leaseExpiresAt'),
        maxLeaseExpiresAt: positiveSafeInteger(record.maxLeaseExpiresAt, 'maxLeaseExpiresAt'),
        policyDigest: contentDigest(record.policyDigest, 'policyDigest'),
        clockSequence: nonNegativeSafeInteger(record.clockSequence, 'clockSequence'),
        clockDigest: contentDigest(record.clockDigest, 'clockDigest'),
        usageSettlementCursor: cursor(record.usageSettlementCursor, 'usageSettlementCursor'),
        authority: parseKernelCommandAuthority(record.authority),
      };
      if (payload.leaseExpiresAt <= payload.previousLeaseExpiresAt
        || payload.leaseExpiresAt > payload.maxLeaseExpiresAt) {
        throw new Error('Capacity Grant Lease renewal escaped max quantum');
      }
      break;
    }
    case 'capacity.grant_expired':
    case 'capacity.reclaim_timed_out': {
      const allowed = type === 'capacity.grant_expired'
        ? new Set(['grantId', 'fence'])
        : new Set(['reclaimId', 'grantId', 'fence']);
      const record = exactRecord(value, allowed, type);
      payload = type === 'capacity.grant_expired'
        ? { grantId: identifier(record.grantId, 'grantId'), fence: positiveSafeInteger(record.fence, 'fence') }
        : {
            reclaimId: identifier(record.reclaimId, 'reclaimId'),
            grantId: identifier(record.grantId, 'grantId'),
            fence: positiveSafeInteger(record.fence, 'fence'),
          };
      break;
    }
    case 'capacity.grant_lease_lost': {
      const record = exactRecord(value, new Set(['grantId', 'fence', 'usage']), type);
      if (record.usage !== 'unknown') throw new Error('Lost Capacity Grant usage must remain unknown');
      payload = {
        grantId: identifier(record.grantId, 'grantId'),
        fence: positiveSafeInteger(record.fence, 'fence'),
        usage: 'unknown',
      };
      break;
    }
    case 'capacity.usage_settled': {
      const record = exactRecord(value, new Set([
        'receiptId', 'grantId', 'fence', 'actualCostMicros', 'settlementRef', 'authenticatedBy', 'authority',
      ]), type);
      payload = {
        receiptId: identifier(record.receiptId, 'receiptId'),
        grantId: identifier(record.grantId, 'grantId'),
        fence: positiveSafeInteger(record.fence, 'fence'),
        actualCostMicros: nonNegativeSafeInteger(record.actualCostMicros, 'actualCostMicros'),
        settlementRef: identifier(record.settlementRef, 'settlementRef'),
        authenticatedBy: identifier(record.authenticatedBy, 'authenticatedBy'),
        authority: parseUsageGatewayAuthority(record.authority),
      };
      break;
    }
    case 'capacity.reclaim_requested': {
      const record = exactRecord(value, new Set(['reclaim']), type);
      payload = { reclaim: parseCapacityReclaim(record.reclaim) };
      break;
    }
    case 'capacity.reclaim_acknowledged': {
      const record = exactRecord(value, new Set([
        'reclaimId', 'grantId', 'projectId', 'fence', 'outcome', 'checkpointRef', 'checkpointDigest', 'authority',
      ]), type);
      if (record.outcome !== 'checkpointed' && record.outcome !== 'declined') {
        throw new Error('Invalid Capacity Reclaim outcome');
      }
      payload = {
        reclaimId: identifier(record.reclaimId, 'reclaimId'),
        grantId: identifier(record.grantId, 'grantId'),
        projectId: identifier(record.projectId, 'projectId'),
        fence: positiveSafeInteger(record.fence, 'fence'),
        outcome: record.outcome,
        ...(record.checkpointRef === undefined
          ? {}
          : { checkpointRef: identifier(record.checkpointRef, 'checkpointRef') }),
        ...(record.checkpointDigest === undefined
          ? {}
          : { checkpointDigest: contentDigest(record.checkpointDigest, 'checkpointDigest') }),
        authority: parseKernelCommandAuthority(record.authority),
      };
      if (payload.outcome === 'checkpointed' && (!payload.checkpointRef || !payload.checkpointDigest)) {
        throw new Error('Checkpointed Capacity Reclaim requires checkpoint ref/digest');
      }
      if (payload.outcome === 'declined' && (payload.checkpointRef || payload.checkpointDigest)) {
        throw new Error('Declined Capacity Reclaim cannot claim a checkpoint');
      }
      break;
    }
    case 'clock.advanced': {
      const record = exactRecord(value, new Set(['now', 'authority']), type);
      payload = {
        now: nonNegativeSafeInteger(record.now, 'Portfolio clock'),
        authority: parseClockAuthority(record.authority),
      };
      break;
    }
    case 'service.normalized': {
      const record = exactRecord(value, new Set(['normalization']), type);
      payload = { normalization: parseServiceNormalization(record.normalization) };
      break;
    }
  }
  return deepFreeze(payload) as PortfolioFactPayloadMap[Type];
}

export function parsePortfolioPolicySnapshot(value: unknown): PortfolioPolicySnapshot {
  const record = exactRecord(value, new Set([
    'revision', 'digest', 'globalBudgetMicros', 'offerTtlTicks', 'leaseTtlTicks',
    'leaseHeartbeatTicks', 'maxLeaseQuantumTicks', 'maxLeaseRenewals',
    'reclaimTtlTicks', 'pools', 'projects',
  ]), 'Portfolio Policy');
  const poolsRecord = dictionary(record.pools, 'Portfolio Policy pools');
  const pools: Record<string, PortfolioResourcePoolPolicy> = {};
  for (const poolId of Object.keys(poolsRecord).sort()) {
    const pool = exactRecord(poolsRecord[poolId], new Set([
      'poolId', 'capacityUnits', 'rateUnitsPerWindow', 'rateWindowTicks',
      'priceMicrosPerBudgetUnit',
    ]), `Portfolio Pool ${poolId}`);
    if (pool.poolId !== poolId) throw new Error('Portfolio Pool dictionary identity drift');
    pools[poolId] = deepFreeze({
      poolId: identifier(pool.poolId, 'poolId'),
      capacityUnits: positiveSafeInteger(pool.capacityUnits, 'pool.capacityUnits'),
      rateUnitsPerWindow: positiveSafeInteger(pool.rateUnitsPerWindow, 'pool.rateUnitsPerWindow'),
      rateWindowTicks: positiveSafeInteger(pool.rateWindowTicks, 'pool.rateWindowTicks'),
      priceMicrosPerBudgetUnit: nonNegativeSafeInteger(
        pool.priceMicrosPerBudgetUnit,
        'pool.priceMicrosPerBudgetUnit',
      ),
    });
  }
  if (Object.keys(pools).length === 0) throw new Error('Portfolio Policy requires Resource Pools');
  const projectsRecord = dictionary(record.projects, 'Portfolio Policy projects');
  const projects: Record<string, PortfolioProjectPolicy> = {};
  for (const projectId of Object.keys(projectsRecord).sort()) {
    const project = parsePortfolioProjectPolicy(projectsRecord[projectId]);
    if (project.projectId !== projectId) throw new Error('Portfolio Project Policy dictionary identity drift');
    for (const poolId of project.allowedPools) {
      if (!pools[poolId]) throw new Error(`Portfolio Project Policy references unknown Pool ${poolId}`);
    }
    projects[projectId] = project;
  }
  const leaseTtlTicks = positiveSafeInteger(record.leaseTtlTicks, 'leaseTtlTicks');
  const leaseHeartbeatTicks = positiveSafeInteger(record.leaseHeartbeatTicks, 'leaseHeartbeatTicks');
  const maxLeaseQuantumTicks = positiveSafeInteger(record.maxLeaseQuantumTicks, 'maxLeaseQuantumTicks');
  const maxLeaseRenewals = nonNegativeSafeInteger(record.maxLeaseRenewals, 'maxLeaseRenewals');
  if (leaseHeartbeatTicks >= leaseTtlTicks) {
    throw new Error('Portfolio lease heartbeat must be shorter than its lease TTL');
  }
  if (maxLeaseQuantumTicks < leaseTtlTicks) {
    throw new Error('Portfolio max lease quantum cannot be shorter than its lease TTL');
  }
  const projection = deepFreeze({
    revision: positiveSafeInteger(record.revision, 'Portfolio Policy revision'),
    globalBudgetMicros: nonNegativeSafeInteger(record.globalBudgetMicros, 'globalBudgetMicros'),
    offerTtlTicks: positiveSafeInteger(record.offerTtlTicks, 'offerTtlTicks'),
    leaseTtlTicks,
    leaseHeartbeatTicks,
    maxLeaseQuantumTicks,
    maxLeaseRenewals,
    reclaimTtlTicks: positiveSafeInteger(record.reclaimTtlTicks, 'reclaimTtlTicks'),
    pools,
    projects,
  });
  const actualDigest = contentDigest(record.digest, 'Portfolio Policy digest');
  if (actualDigest !== digest(projection)) throw new Error('Portfolio Policy digest drift');
  return deepFreeze({ ...projection, digest: actualDigest });
}

export function createPortfolioPolicySnapshot(
  input: Omit<PortfolioPolicySnapshot, 'digest'>,
): PortfolioPolicySnapshot {
  const projection = deepFreeze(structuredClone(input));
  return parsePortfolioPolicySnapshot({ ...projection, digest: digest(projection) });
}

export function parsePortfolioProjectPolicy(value: unknown): PortfolioProjectPolicy {
  const record = exactRecord(value, new Set([
    'projectId', 'revision', 'lane', 'weight', 'hardBudgetMicros', 'allowedPools',
    'maxOutstandingRequests', 'maxConcurrentGrants', 'burstLimit', 'starvationTicks', 'status',
  ]), 'Portfolio Project Policy');
  const lane = portfolioLane(record.lane);
  const status = record.status;
  if (status !== 'active' && status !== 'paused' && status !== 'reclaim_checkpointable') {
    throw new Error('Invalid Portfolio Project status');
  }
  const allowedPools = stringList(record.allowedPools, 'allowedPools');
  if (allowedPools.length === 0) throw new Error('Portfolio Project Policy requires allowed Pools');
  const maxOutstandingRequests = positiveSafeInteger(record.maxOutstandingRequests, 'maxOutstandingRequests');
  const maxConcurrentGrants = positiveSafeInteger(record.maxConcurrentGrants, 'maxConcurrentGrants');
  const burstLimit = positiveSafeInteger(record.burstLimit, 'burstLimit');
  if (maxConcurrentGrants > maxOutstandingRequests || burstLimit > maxOutstandingRequests) {
    throw new Error('Portfolio Project caps are inconsistent');
  }
  return deepFreeze({
    projectId: identifier(record.projectId, 'projectId'),
    revision: positiveSafeInteger(record.revision, 'Project Policy revision'),
    lane,
    weight: positiveSafeInteger(record.weight, 'Project Policy weight'),
    hardBudgetMicros: nonNegativeSafeInteger(record.hardBudgetMicros, 'hardBudgetMicros'),
    allowedPools,
    maxOutstandingRequests,
    maxConcurrentGrants,
    burstLimit,
    starvationTicks: positiveSafeInteger(record.starvationTicks, 'starvationTicks'),
    status,
  });
}

function parsePriorityOverride(value: unknown): PortfolioPriorityOverride {
  const record = exactRecord(value, new Set([
    'overrideId', 'requestId', 'projectId', 'lane', 'policyRevision',
    'requestPayloadDigest', 'expiresAt',
  ]), 'Portfolio Priority Override');
  return deepFreeze({
    overrideId: identifier(record.overrideId, 'overrideId'),
    requestId: identifier(record.requestId, 'requestId'),
    projectId: identifier(record.projectId, 'projectId'),
    lane: portfolioLane(record.lane),
    policyRevision: positiveSafeInteger(record.policyRevision, 'policyRevision'),
    requestPayloadDigest: contentDigest(record.requestPayloadDigest, 'requestPayloadDigest'),
    expiresAt: positiveSafeInteger(record.expiresAt, 'expiresAt'),
  });
}

function parseGovernanceProof(value: unknown): PortfolioGovernanceProof {
  const record = exactRecord(value, new Set([
    'principalId', 'authorizedBy', 'reasonDigest', 'targetDigest', 'expectedRevision',
  ]), 'Portfolio Governance proof');
  return deepFreeze({
    principalId: identifier(record.principalId, 'principalId'),
    authorizedBy: identifier(record.authorizedBy, 'authorizedBy'),
    reasonDigest: contentDigest(record.reasonDigest, 'reasonDigest'),
    targetDigest: contentDigest(record.targetDigest, 'targetDigest'),
    expectedRevision: nonNegativeSafeInteger(record.expectedRevision, 'expectedRevision'),
  });
}

function parseValidatedBundleAuthority(value: unknown): PortfolioValidatedBundleAuthority {
  const record = exactRecord(value, new Set([
    'requestDigest', 'resourceBundleDigest',
    'catalogGenerationId', 'catalogRevision', 'catalogDigest', 'profileRevisionId',
    'profileDigest', 'profileCeilingDigest', 'validatedBundleDigest', 'reservedCostMicros',
  ]), 'Validated Atomic Resource Bundle authority');
  return deepFreeze({
    requestDigest: contentDigest(record.requestDigest, 'requestDigest'),
    resourceBundleDigest: contentDigest(record.resourceBundleDigest, 'resourceBundleDigest'),
    catalogGenerationId: identifier(record.catalogGenerationId, 'catalogGenerationId'),
    catalogRevision: positiveSafeInteger(record.catalogRevision, 'catalogRevision'),
    catalogDigest: contentDigest(record.catalogDigest, 'catalogDigest'),
    profileRevisionId: identifier(record.profileRevisionId, 'profileRevisionId'),
    profileDigest: contentDigest(record.profileDigest, 'profileDigest'),
    profileCeilingDigest: contentDigest(record.profileCeilingDigest, 'profileCeilingDigest'),
    validatedBundleDigest: contentDigest(record.validatedBundleDigest, 'validatedBundleDigest'),
    reservedCostMicros: nonNegativeSafeInteger(record.reservedCostMicros, 'reservedCostMicros'),
  });
}

function parseKernelCommandAuthority(value: unknown): PortfolioKernelCommandAuthority {
  const record = exactRecord(value, new Set([
    'portfolioId', 'action', 'projectId', 'requestId', 'grantId', 'fence',
    'assignmentRef', 'reclaimId', 'outcome', 'checkpointRef', 'checkpointDigest',
    'heartbeatSequence', 'clockSequence', 'clockDigest', 'policyDigest', 'usageSettlementCursor',
    'failureReason', 'kernelSequence', 'kernelFactDigest',
    'commandDigest', 'authorizedBy',
  ]), 'Portfolio Kernel command authority');
  if (record.action !== 'consume' && record.action !== 'assignment_failed'
    && record.action !== 'reclaim_acknowledge' && record.action !== 'renew') {
    throw new Error('Invalid Portfolio Kernel command authority action');
  }
  if (record.outcome !== undefined && record.outcome !== 'checkpointed' && record.outcome !== 'declined') {
    throw new Error('Invalid Portfolio Kernel command authority outcome');
  }
  return deepFreeze({
    portfolioId: identifier(record.portfolioId, 'portfolioId'),
    action: record.action,
    projectId: identifier(record.projectId, 'projectId'),
    requestId: identifier(record.requestId, 'requestId'),
    grantId: identifier(record.grantId, 'grantId'),
    fence: positiveSafeInteger(record.fence, 'fence'),
    assignmentRef: identifier(record.assignmentRef, 'assignmentRef'),
    ...(record.reclaimId === undefined ? {} : { reclaimId: identifier(record.reclaimId, 'reclaimId') }),
    ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
    ...(record.checkpointRef === undefined
      ? {}
      : { checkpointRef: identifier(record.checkpointRef, 'checkpointRef') }),
    ...(record.checkpointDigest === undefined
      ? {}
      : { checkpointDigest: contentDigest(record.checkpointDigest, 'checkpointDigest') }),
    ...(record.heartbeatSequence === undefined
      ? {}
      : { heartbeatSequence: positiveSafeInteger(record.heartbeatSequence, 'heartbeatSequence') }),
    ...(record.clockSequence === undefined
      ? {}
      : { clockSequence: nonNegativeSafeInteger(record.clockSequence, 'clockSequence') }),
    ...(record.clockDigest === undefined
      ? {}
      : { clockDigest: contentDigest(record.clockDigest, 'clockDigest') }),
    ...(record.policyDigest === undefined
      ? {}
      : { policyDigest: contentDigest(record.policyDigest, 'policyDigest') }),
    ...(record.usageSettlementCursor === undefined
      ? {}
      : { usageSettlementCursor: cursor(record.usageSettlementCursor, 'usageSettlementCursor') }),
    ...(record.failureReason === undefined ? {} : {
      failureReason: failureReason(record.failureReason),
    }),
    ...(record.kernelSequence === undefined ? {} : {
      kernelSequence: nonNegativeSafeInteger(record.kernelSequence, 'kernelSequence'),
    }),
    ...(record.kernelFactDigest === undefined ? {} : {
      kernelFactDigest: contentDigest(record.kernelFactDigest, 'kernelFactDigest'),
    }),
    commandDigest: contentDigest(record.commandDigest, 'commandDigest'),
    authorizedBy: identifier(record.authorizedBy, 'authorizedBy'),
  });
}

function failureReason(value: unknown): PortfolioGrantAssignmentFailureReason {
  if (value !== 'task_stale' && value !== 'task_terminal' && value !== 'run_terminal') {
    throw new Error('Invalid Portfolio Kernel command failure reason');
  }
  return value;
}

function parseUsageGatewayAuthority(value: unknown): PortfolioUsageGatewayAuthority {
  const record = exactRecord(value, new Set([
    'portfolioId', 'receiptId', 'requestId', 'grantId', 'fence', 'actualCostMicros',
    'settlementRef', 'receiptDigest', 'authenticatedBy',
  ]), 'Portfolio Usage Gateway authority');
  return deepFreeze({
    portfolioId: identifier(record.portfolioId, 'portfolioId'),
    receiptId: identifier(record.receiptId, 'receiptId'),
    requestId: identifier(record.requestId, 'requestId'),
    grantId: identifier(record.grantId, 'grantId'),
    fence: positiveSafeInteger(record.fence, 'fence'),
    actualCostMicros: nonNegativeSafeInteger(record.actualCostMicros, 'actualCostMicros'),
    settlementRef: identifier(record.settlementRef, 'settlementRef'),
    receiptDigest: contentDigest(record.receiptDigest, 'receiptDigest'),
    authenticatedBy: identifier(record.authenticatedBy, 'authenticatedBy'),
  });
}

function parseClockAuthority(value: unknown): PortfolioClockAuthority {
  const record = exactRecord(value, new Set([
    'portfolioId', 'now', 'clockDigest', 'authorizedBy',
  ]), 'Portfolio clock authority');
  return deepFreeze({
    portfolioId: identifier(record.portfolioId, 'portfolioId'),
    now: nonNegativeSafeInteger(record.now, 'Portfolio clock'),
    clockDigest: contentDigest(record.clockDigest, 'clockDigest'),
    authorizedBy: identifier(record.authorizedBy, 'authorizedBy'),
  });
}

function parseCapacityGrant(value: unknown): PortfolioCapacityGrant {
  const record = exactRecord(value, new Set([
    'grantId', 'requestId', 'projectId', 'fence', 'resourceBundle',
    'requestDigest', 'resourceBundleDigest',
    'catalogGenerationId', 'catalogRevision', 'catalogDigest', 'profileRevisionId',
    'profileDigest', 'profileCeilingDigest', 'validatedBundleDigest', 'reservedCostMicros',
    'portfolioPolicyRevision', 'portfolioPolicyDigest', 'projectPolicyRevision', 'lane',
    'issuedAt', 'issuedSequence', 'offerExpiresAt', 'status',
  ]), 'Portfolio Capacity Grant');
  const status = record.status;
  if (status !== 'offered') throw new Error('Capacity Grant offer fact cannot forge a terminal status');
  const issuedAt = nonNegativeSafeInteger(record.issuedAt, 'issuedAt');
  const offerExpiresAt = positiveSafeInteger(record.offerExpiresAt, 'offerExpiresAt');
  if (offerExpiresAt <= issuedAt) throw new Error('Capacity Grant offer expiry is stale');
  return deepFreeze({
    grantId: identifier(record.grantId, 'grantId'),
    requestId: identifier(record.requestId, 'requestId'),
    projectId: identifier(record.projectId, 'projectId'),
    fence: positiveSafeInteger(record.fence, 'fence'),
    resourceBundle: parsePortfolioResourceBundle(record.resourceBundle),
    requestDigest: contentDigest(record.requestDigest, 'requestDigest'),
    resourceBundleDigest: contentDigest(record.resourceBundleDigest, 'resourceBundleDigest'),
    catalogGenerationId: identifier(record.catalogGenerationId, 'catalogGenerationId'),
    catalogRevision: positiveSafeInteger(record.catalogRevision, 'catalogRevision'),
    catalogDigest: contentDigest(record.catalogDigest, 'catalogDigest'),
    profileRevisionId: identifier(record.profileRevisionId, 'profileRevisionId'),
    profileDigest: contentDigest(record.profileDigest, 'profileDigest'),
    profileCeilingDigest: contentDigest(record.profileCeilingDigest, 'profileCeilingDigest'),
    validatedBundleDigest: contentDigest(record.validatedBundleDigest, 'validatedBundleDigest'),
    reservedCostMicros: nonNegativeSafeInteger(record.reservedCostMicros, 'reservedCostMicros'),
    portfolioPolicyRevision: positiveSafeInteger(record.portfolioPolicyRevision, 'portfolioPolicyRevision'),
    portfolioPolicyDigest: contentDigest(record.portfolioPolicyDigest, 'portfolioPolicyDigest'),
    projectPolicyRevision: positiveSafeInteger(record.projectPolicyRevision, 'projectPolicyRevision'),
    lane: portfolioLane(record.lane),
    issuedAt,
    issuedSequence: nonNegativeSafeInteger(record.issuedSequence, 'issuedSequence'),
    offerExpiresAt,
    status: 'offered',
  });
}

function parseCapacityReclaim(value: unknown): PortfolioCapacityReclaim {
  const record = exactRecord(value, new Set([
    'reclaimId', 'grantId', 'projectId', 'reservedForRequestId', 'requestedAt',
    'deadline', 'reason', 'status',
  ]), 'Portfolio Capacity Reclaim');
  const reason = record.reason;
  if (!['higher_portfolio_priority', 'starvation_bound', 'project_pause'].includes(String(reason))) {
    throw new Error('Invalid Capacity Reclaim reason');
  }
  const status = record.status;
  if (status !== 'pending') throw new Error('Capacity Reclaim request fact cannot forge a terminal status');
  const requestedAt = nonNegativeSafeInteger(record.requestedAt, 'requestedAt');
  const deadline = positiveSafeInteger(record.deadline, 'deadline');
  if (deadline <= requestedAt) throw new Error('Capacity Reclaim deadline is stale');
  return deepFreeze({
    reclaimId: identifier(record.reclaimId, 'reclaimId'),
    grantId: identifier(record.grantId, 'grantId'),
    projectId: identifier(record.projectId, 'projectId'),
    ...(record.reservedForRequestId === undefined
      ? {}
      : { reservedForRequestId: identifier(record.reservedForRequestId, 'reservedForRequestId') }),
    requestedAt,
    deadline,
    reason: reason as PortfolioCapacityReclaim['reason'],
    status: 'pending',
  });
}

function parseServiceNormalization(value: unknown): PortfolioServiceNormalization {
  const record = exactRecord(value, new Set([
    'normalizationId', 'divisor', 'projectService',
  ]), 'Portfolio Service Normalization');
  const service = dictionary(record.projectService, 'projectService');
  const projectService: Record<string, number> = {};
  for (const projectId of Object.keys(service).sort()) {
    projectService[identifier(projectId, 'projectService projectId')] =
      nonNegativeSafeInteger(service[projectId], `projectService.${projectId}`);
  }
  return deepFreeze({
    normalizationId: identifier(record.normalizationId, 'normalizationId'),
    divisor: positiveSafeInteger(record.divisor, 'normalization divisor'),
    projectService,
  });
}

type NormalizedPortfolioFactDraft = {
  [Type in PortfolioFactType]: Readonly<{
    eventId: string;
    occurredAt: number;
    type: Type;
    payload: PortfolioFactPayloadMap[Type];
  }>
}[PortfolioFactType];

export function parsePortfolioFactDraft(draft: PortfolioFactDraft): NormalizedPortfolioFactDraft {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new Error('Invalid Portfolio fact draft');
  }
  if (!PORTFOLIO_FACT_TYPES.has(draft.type)) throw new Error('Invalid Portfolio fact type');
  if (!Number.isFinite(draft.occurredAt) || draft.occurredAt < 0) {
    throw new Error('Invalid Portfolio fact occurredAt');
  }
  return deepFreeze({
    eventId: identifier(draft.eventId, 'eventId'),
    occurredAt: draft.occurredAt,
    type: draft.type,
    payload: parsePortfolioFactPayload(draft.type, draft.payload),
  } as NormalizedPortfolioFactDraft);
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
      if (eventMatch.type !== draft.type || stableJson(eventMatch.payload) !== stableJson(draft.payload)) {
        throw new PortfolioEventIdentityConflictError(portfolioId, draft.eventId);
      }
      continue;
    }
    byEventId.set(draft.eventId, draft);
    if (draft.type === 'capacity.requested') {
      const requestMatch = byRequestId.get(draft.payload.request.requestId);
      const headMatch = byHead.get(headKey(draft.payload.request));
      for (const [identity, match] of [
        [`requestId:${draft.payload.request.requestId}`, requestMatch],
        [`opaqueHeadId:${headKey(draft.payload.request)}`, headMatch],
      ] as const) {
        if (match) throw new PortfolioRequestIdentityConflictError(portfolioId, identity);
      }
      byRequestId.set(draft.payload.request.requestId, draft);
      byHead.set(headKey(draft.payload.request), draft);
    }
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

function dictionary(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a dictionary`);
  }
  return value as Record<string, unknown>;
}

function stringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map((item, index) => identifier(item, `${label}.${index}`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze([...result].sort());
}

function portfolioLane(value: unknown): PortfolioLane {
  if (value !== 'urgent' && value !== 'high' && value !== 'normal' && value !== 'low') {
    throw new Error('Invalid Portfolio lane');
  }
  return value;
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

function cursor(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < -1) throw new Error(`${path} must be a safe cursor`);
  return Number(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
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
