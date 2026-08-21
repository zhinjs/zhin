import {
  portfolioProjectBudget,
  portfolioRequestBlockers,
  portfolioRequestStatus,
  type PortfolioAdmissionState,
} from './portfolio-admission.js';
import type {
  PortfolioCapacityGrant,
  PortfolioCapacityReclaim,
  PortfolioCapacityRequest,
  PortfolioLane,
  PortfolioProjectStatus,
} from './portfolio-journal.js';
import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface PortfolioSponsorProjection {
  readonly version: 1;
  readonly portfolioId: string;
  readonly sourceSequence: number;
  readonly clock: Readonly<{ now: number; sequence: number; digest?: string }>;
  readonly policy: Readonly<{ revision: number; digest: string }>;
  readonly globalBudget: Readonly<{
    limitMicros: number; reservedMicros: number; spentMicros: number; availableMicros: number;
  }>;
  readonly projects: Readonly<Record<string, PortfolioSponsorProjectProjection>>;
  readonly digest: string;
}

export interface PortfolioSponsorProjectProjection {
  readonly projectId: string;
  readonly policyRevision: number;
  readonly lane: PortfolioLane;
  readonly status: PortfolioProjectStatus;
  readonly weight: number;
  readonly queueHead?: Readonly<{
    requestId: string; opaqueHeadId: string; schedulerRevision: string;
    schedulerSequence: number; payloadDigest: string; starvationAt: number; deadlineAt?: number;
  }>;
  readonly grants: readonly Readonly<{
    grantId: string; requestId: string; fence: number; status: PortfolioCapacityGrant['status'];
    resourceBundleDigest: string; offerExpiresAt: number; leaseExpiresAt?: number;
  }>[];
  readonly reclaims: readonly Readonly<{
    reclaimId: string; grantId: string; status: PortfolioCapacityReclaim['status'];
    reason: PortfolioCapacityReclaim['reason']; deadline: number; reservedForRequestId?: string;
  }>[];
  readonly budget: Readonly<{
    limitMicros: number; reservedMicros: number; spentMicros: number; availableMicros: number;
  }>;
  readonly rate: Readonly<Record<string, Readonly<{
    windowStart: number; windowEnd: number; usedUnits: number; limitUnits: number;
  }>>>;
  readonly blockers: readonly string[];
  readonly fairness: Readonly<{
    normalizedService: number; weight: number; weightedService: number; normalizedAtSequence: number;
  }>;
}

export function createPortfolioSponsorProjection(state: PortfolioAdmissionState): PortfolioSponsorProjection {
  const policy = state.policy;
  if (!policy) throw new Error('Portfolio Sponsor projection requires a pinned Policy');
  const projects: Record<string, PortfolioSponsorProjectProjection> = {};
  for (const projectId of Object.keys(policy.projects).sort()) {
    const project = policy.projects[projectId]!;
    const queueHead = projectQueueHead(state, projectId);
    const budget = portfolioProjectBudget(state, projectId);
    const normalizedService = state.normalizedService[projectId] ?? 0;
    projects[projectId] = deepFreeze({
      projectId,
      policyRevision: project.revision,
      lane: project.lane,
      status: project.status,
      weight: project.weight,
      ...(queueHead ? { queueHead: projectQueueProjection(queueHead) } : {}),
      grants: Object.values(state.grants)
        .filter(grant => grant.projectId === projectId)
        .sort((left, right) => left.grantId.localeCompare(right.grantId))
        .map(grantProjection),
      reclaims: Object.values(state.reclaims)
        .filter(reclaim => reclaim.projectId === projectId)
        .sort((left, right) => left.reclaimId.localeCompare(right.reclaimId))
        .map(reclaimProjection),
      budget: {
        limitMicros: project.hardBudgetMicros,
        reservedMicros: budget.reservedMicros,
        spentMicros: budget.spentMicros,
        availableMicros: budget.availableMicros,
      },
      rate: rateProjection(state, projectId),
      blockers: queueHead ? portfolioRequestBlockers(state, queueHead.requestId) : Object.freeze([]),
      fairness: {
        normalizedService,
        weight: project.weight,
        weightedService: Math.floor(normalizedService / project.weight),
        normalizedAtSequence: state.normalizedAtSequence,
      },
    });
  }
  const grants = Object.values(state.grants);
  const spentMicros = grants.filter(grant => grant.status === 'settled')
    .reduce((total, grant) => total + (grant.actualCostMicros ?? 0), 0);
  const reservedMicros = grants.filter(grant =>
    ['offered', 'consumed', 'reclaim_requested', 'usage_pending', 'usage_unknown'].includes(grant.status))
    .reduce((total, grant) => total + grant.reservedCostMicros, 0);
  const body = deepFreeze({
    version: 1 as const,
    portfolioId: state.portfolioId,
    sourceSequence: state.sequence,
    clock: { now: state.now, sequence: state.clockSequence, ...(state.clockDigest ? { digest: state.clockDigest } : {}) },
    policy: { revision: policy.revision, digest: policy.digest },
    globalBudget: {
      limitMicros: policy.globalBudgetMicros,
      reservedMicros,
      spentMicros,
      availableMicros: policy.globalBudgetMicros - reservedMicros - spentMicros,
    },
    projects,
  });
  assertContentFree(body);
  return deepFreeze({ ...body, digest: digest(body) });
}

function projectQueueHead(state: PortfolioAdmissionState, projectId: string): PortfolioCapacityRequest | undefined {
  return Object.values(state.requests)
    .map(item => item.request)
    .filter(request => request.projectId === projectId
      && portfolioRequestStatus(state, request.requestId) === 'pending')
    .sort((left, right) => left.localOrder - right.localOrder
      || left.schedulerSequence - right.schedulerSequence
      || left.requestId.localeCompare(right.requestId))[0];
}

function projectQueueProjection(request: PortfolioCapacityRequest) {
  return deepFreeze({
    requestId: request.requestId,
    opaqueHeadId: request.opaqueHeadId,
    schedulerRevision: request.schedulerRevision,
    schedulerSequence: request.schedulerSequence,
    payloadDigest: request.payloadDigest,
    starvationAt: request.starvationAt,
    ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt }),
  });
}

function grantProjection(grant: PortfolioCapacityGrant) {
  return deepFreeze({
    grantId: grant.grantId, requestId: grant.requestId, fence: grant.fence, status: grant.status,
    resourceBundleDigest: grant.resourceBundleDigest, offerExpiresAt: grant.offerExpiresAt,
    ...(grant.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: grant.leaseExpiresAt }),
  });
}

function reclaimProjection(reclaim: PortfolioCapacityReclaim) {
  return deepFreeze({
    reclaimId: reclaim.reclaimId, grantId: reclaim.grantId, status: reclaim.status,
    reason: reclaim.reason, deadline: reclaim.deadline,
    ...(reclaim.reservedForRequestId === undefined
      ? {}
      : { reservedForRequestId: reclaim.reservedForRequestId }),
  });
}

function rateProjection(state: PortfolioAdmissionState, projectId: string) {
  const result: Record<string, Readonly<{
    windowStart: number; windowEnd: number; usedUnits: number; limitUnits: number;
  }>> = {};
  for (const [poolId, pool] of Object.entries(state.policy!.pools).sort(([left], [right]) => left.localeCompare(right))) {
    const windowStart = Math.floor(state.now / pool.rateWindowTicks) * pool.rateWindowTicks;
    const usedUnits = Object.values(state.grants)
      .filter(grant => grant.projectId === projectId
        && (grant.status === 'offered' || (grant.consumedAt !== undefined && grant.consumedAt >= windowStart)))
      .reduce((total, grant) => total
        + (grant.resourceBundle.demands.find(demand => demand.poolId === poolId)?.rateUnits ?? 0), 0);
    result[poolId] = deepFreeze({
      windowStart,
      windowEnd: windowStart + pool.rateWindowTicks,
      usedUnits,
      limitUnits: pool.rateUnitsPerWindow,
    });
  }
  return deepFreeze(result);
}

function assertContentFree(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertContentFree(item);
    return;
  }
  const forbidden = /^(?:prompt|message|context|memory|artifact|evidence|title|objective|body|content|toolArgs)$/iu;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key)) throw new Error(`Portfolio Sponsor projection contains forbidden ${key}`);
    assertContentFree(item);
  }
}
