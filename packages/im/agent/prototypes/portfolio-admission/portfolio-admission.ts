/**
 * PROTOTYPE — decision-map ticket #11. Delete after the contract is absorbed.
 *
 * A Portfolio may reserve shared capacity for opaque Workroom requests. It may
 * not inspect Project context, select a Task, or write Task/Run state.
 */

export type PortfolioLane = 'urgent' | 'high' | 'normal' | 'low';
export type ProjectAdmissionStatus = 'active' | 'paused' | 'reclaim_checkpointable';
export type GrantPreemptibility = 'checkpointable' | 'atomic';

export interface ResourcePoolPolicy {
  readonly id: string;
  readonly capacityUnits: number;
  readonly maxUnitsPerRequest: number;
  readonly rateUnitsPerWindow: number;
  readonly rateWindowTicks: number;
  readonly pricePerBudgetUnitMicros: number;
}

export interface ProjectPortfolioPolicy {
  readonly projectId: string;
  readonly revision: number;
  readonly lane: PortfolioLane;
  readonly weight: number;
  readonly hardBudgetMicros: number;
  readonly maxConcurrentGrants: number;
  readonly maxOutstandingRequests: number;
  readonly starvationAfterTicks: number;
  readonly status: ProjectAdmissionStatus;
  readonly allowedPools: readonly string[];
}

export interface PortfolioPolicySnapshot {
  readonly revision: number;
  readonly globalBudgetMicros: number;
  readonly offerTtlTicks: number;
  readonly leaseTtlTicks: number;
  readonly reclaimDeadlineTicks: number;
  readonly pools: Readonly<Record<string, ResourcePoolPolicy>>;
  readonly projects: Readonly<Record<string, ProjectPortfolioPolicy>>;
}

/** Opaque identity is enough to correlate the grant inside one Workroom. */
export interface WorkRef {
  readonly runId: string;
  readonly schedulerSequence: number;
  readonly localOrder: number;
  readonly profileDigest: string;
}

export interface ResourceDemand {
  readonly poolId: string;
  readonly capacityUnits: number;
  readonly rateUnits: number;
  readonly budgetUnits: number;
}

export interface CapacityRequest {
  readonly id: string;
  readonly projectId: string;
  readonly workRef: WorkRef;
  readonly demands: readonly ResourceDemand[];
  readonly preemptibility: GrantPreemptibility;
  readonly deadline?: number;
  readonly submittedAt: number;
  readonly submittedSeq: number;
  readonly fingerprint: string;
  readonly cancelled: boolean;
}

export type CapacityGrantStatus =
  | 'offered'
  | 'consumed'
  | 'reclaim_requested'
  | 'usage_pending'
  | 'usage_unknown'
  | 'settled'
  | 'expired';

export interface CapacityGrant {
  readonly id: string;
  readonly fence: number;
  readonly requestId: string;
  readonly projectId: string;
  readonly demands: readonly ResourceDemand[];
  readonly reservedCostMicros: number;
  readonly portfolioPolicyRevision: number;
  readonly projectPolicyRevision: number;
  readonly laneAtIssue: PortfolioLane;
  readonly issuedAt: number;
  readonly offerExpiresAt: number;
  readonly leaseExpiresAt?: number;
  readonly consumedAt?: number;
  readonly assignmentRef?: string;
  readonly status: CapacityGrantStatus;
  readonly actualCostMicros?: number;
  readonly settlementRef?: string;
}

export interface CapacityReclaim {
  readonly id: string;
  readonly grantId: string;
  readonly projectId: string;
  readonly reservedForRequestId?: string;
  readonly requestedAt: number;
  readonly deadline: number;
  readonly reason: 'higher_portfolio_priority' | 'starvation_bound' | 'project_pause';
  readonly status: 'pending' | 'checkpointed' | 'declined' | 'timed_out';
}

export interface PriorityOverride {
  readonly id: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly lane: PortfolioLane;
  readonly expiresAt: number;
}

export interface PortfolioState {
  readonly sequence: number;
  readonly now: number;
  readonly policy: PortfolioPolicySnapshot;
  readonly requests: Readonly<Record<string, CapacityRequest>>;
  readonly grants: Readonly<Record<string, CapacityGrant>>;
  readonly reclaims: Readonly<Record<string, CapacityReclaim>>;
  readonly priorityOverrides: Readonly<Record<string, PriorityOverride>>;
}

export type PortfolioActor = Readonly<{
  id: string;
  role: 'sponsor' | 'portfolio_kernel' | 'workroom_scheduler' | 'workroom_kernel' | 'usage_gateway';
  projectId?: string;
}>;

export type PortfolioEvent = Readonly<{
  seq: number;
  type:
    | 'portfolio.created'
    | 'clock.advanced'
    | 'project.policy_updated'
    | 'priority.override_set'
    | 'capacity.request_submitted'
    | 'capacity.request_cancelled'
    | 'capacity.grant_offered'
    | 'capacity.grant_consumed'
    | 'capacity.grant_expired'
    | 'capacity.grant_lease_lost'
    | 'capacity.usage_settled'
    | 'capacity.reclaim_requested'
    | 'capacity.reclaim_acknowledged'
    | 'capacity.reclaim_timed_out';
  actor: PortfolioActor;
  payload: Readonly<Record<string, unknown>>;
}>;

export type PortfolioCommand =
  | Readonly<{ type: 'advance_clock'; actor: PortfolioActor; ticks: number }>
  | Readonly<{ type: 'update_project_policy'; actor: PortfolioActor; policy: ProjectPortfolioPolicy }>
  | Readonly<{ type: 'set_priority_override'; actor: PortfolioActor; override: PriorityOverride }>
  | Readonly<{
    type: 'submit_request'; actor: PortfolioActor; request: Readonly<{
      id: string;
      projectId: string;
      workRef: WorkRef;
      demands: readonly ResourceDemand[];
      preemptibility: GrantPreemptibility;
      deadline?: number;
    }>;
  }>
  | Readonly<{ type: 'cancel_request'; actor: PortfolioActor; requestId: string }>
  | Readonly<{ type: 'decide_admission'; actor: PortfolioActor }>
  | Readonly<{ type: 'consume_grant'; actor: PortfolioActor; grantId: string; assignmentRef: string }>
  | Readonly<{
    type: 'acknowledge_reclaim'; actor: PortfolioActor; reclaimId: string;
    outcome: 'checkpointed' | 'declined';
  }>
  | Readonly<{
    type: 'settle_usage'; actor: PortfolioActor; grantId: string;
    actualCostMicros: number; settlementRef: string;
  }>;

const LANE_ORDER: Readonly<Record<PortfolioLane, number>> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const CAPACITY_HOLDING = new Set<CapacityGrantStatus>(['offered', 'consumed', 'reclaim_requested']);
const BUDGET_HOLDING = new Set<CapacityGrantStatus>([
  'offered', 'consumed', 'reclaim_requested', 'usage_pending', 'usage_unknown',
]);

export function initialPortfolioJournal(policy: PortfolioPolicySnapshot): readonly PortfolioEvent[] {
  validatePolicy(policy);
  return [event(0, 'portfolio.created', { id: 'portfolio-kernel', role: 'portfolio_kernel' }, { policy })];
}

export function replayPortfolio(journal: readonly PortfolioEvent[]): PortfolioState {
  const created = journal[0];
  if (!created || created.type !== 'portfolio.created') {
    throw new Error('Portfolio Journal must begin with portfolio.created');
  }
  let state: PortfolioState = {
    sequence: 0,
    now: 0,
    policy: created.payload.policy as unknown as PortfolioPolicySnapshot,
    requests: {},
    grants: {},
    reclaims: {},
    priorityOverrides: {},
  };
  for (const entry of journal) state = evolvePortfolio(state, entry);
  return state;
}

export function dispatchPortfolio(
  journal: readonly PortfolioEvent[],
  command: PortfolioCommand,
): readonly PortfolioEvent[] {
  const state = replayPortfolio(journal);
  const additions = decidePortfolio(state, command);
  return Object.freeze([
    ...journal,
    ...additions.map((entry, index) => ({ ...entry, seq: journal.length + index })),
  ]);
}

export function requestStatus(
  state: PortfolioState,
  requestId: string,
): 'pending' | 'granted' | 'usage_blocked' | 'settled' | 'cancelled' {
  const request = requireRequest(state, requestId);
  if (request.cancelled) return 'cancelled';
  const grants = Object.values(state.grants)
    .filter((grant) => grant.requestId === requestId)
    .sort((left, right) => right.fence - left.fence);
  const latest = grants[0];
  if (!latest || latest.status === 'expired') return 'pending';
  if (latest.status === 'settled') return 'settled';
  if (latest.status === 'usage_pending' || latest.status === 'usage_unknown') return 'usage_blocked';
  return 'granted';
}

export function projectBudget(
  state: PortfolioState,
  projectId: string,
): Readonly<{ limitMicros: number; spentMicros: number; reservedMicros: number; availableMicros: number }> {
  const policy = requireProjectPolicy(state, projectId);
  const spentMicros = Object.values(state.grants)
    .filter((grant) => grant.projectId === projectId && grant.status === 'settled')
    .reduce((sum, grant) => sum + (grant.actualCostMicros ?? 0), 0);
  const reservedMicros = Object.values(state.grants)
    .filter((grant) => grant.projectId === projectId && BUDGET_HOLDING.has(grant.status))
    .reduce((sum, grant) => sum + grant.reservedCostMicros, 0);
  return {
    limitMicros: policy.hardBudgetMicros,
    spentMicros,
    reservedMicros,
    availableMicros: policy.hardBudgetMicros - spentMicros - reservedMicros,
  };
}

export function admissionBlockers(state: PortfolioState, requestId: string): readonly string[] {
  return blockersFor(state, requireRequest(state, requestId));
}

function decidePortfolio(
  state: PortfolioState,
  command: PortfolioCommand,
): readonly Omit<PortfolioEvent, 'seq'>[] {
  switch (command.type) {
    case 'advance_clock': {
      requireRole(command.actor, 'portfolio_kernel');
      if (!Number.isInteger(command.ticks) || command.ticks <= 0) throw new Error('ticks must be a positive integer');
      const target = state.now + command.ticks;
      const decided: Omit<PortfolioEvent, 'seq'>[] = [domainEvent('clock.advanced', command.actor, { now: target })];
      for (const reclaim of Object.values(state.reclaims)) {
        if (reclaim.status === 'pending' && reclaim.deadline <= target) {
          decided.push(domainEvent('capacity.reclaim_timed_out', command.actor, { reclaimId: reclaim.id }));
        }
      }
      for (const grant of Object.values(state.grants)) {
        if (grant.status === 'offered' && grant.offerExpiresAt <= target) {
          decided.push(domainEvent('capacity.grant_expired', command.actor, { grantId: grant.id }));
        } else if (
          (grant.status === 'consumed' || grant.status === 'reclaim_requested')
          && grant.leaseExpiresAt !== undefined
          && grant.leaseExpiresAt <= target
        ) {
          decided.push(domainEvent('capacity.grant_lease_lost', command.actor, {
            grantId: grant.id,
            reason: 'lease_expired',
          }));
        }
      }
      return decided;
    }
    case 'update_project_policy': {
      requireRole(command.actor, 'sponsor');
      const previous = requireProjectPolicy(state, command.policy.projectId);
      validateProjectPolicy(command.policy, state.policy.pools);
      if (command.policy.revision !== previous.revision + 1) {
        throw new Error(`Project policy CAS failed: expected revision ${previous.revision + 1}`);
      }
      const decided: Omit<PortfolioEvent, 'seq'>[] = [domainEvent('project.policy_updated', command.actor, {
        policy: command.policy,
      })];
      if (command.policy.status === 'reclaim_checkpointable') {
        for (const grant of Object.values(state.grants)) {
          const request = state.requests[grant.requestId];
          if (
            grant.projectId === command.policy.projectId
            && grant.status === 'consumed'
            && request?.preemptibility === 'checkpointable'
          ) {
            decided.push(makeReclaimEvent(state, command.actor, grant, undefined, 'project_pause', decided.length));
          }
        }
      }
      return decided;
    }
    case 'set_priority_override': {
      requireRole(command.actor, 'sponsor');
      const request = requireRequest(state, command.override.requestId);
      if (request.projectId !== command.override.projectId) throw new Error('Priority Override project/request mismatch');
      if (command.override.expiresAt <= state.now) throw new Error('Priority Override must expire in the future');
      const existing = state.priorityOverrides[command.override.id];
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(command.override)) {
          throw new Error(`Priority Override id conflict: ${command.override.id}`);
        }
        return [];
      }
      return [domainEvent('priority.override_set', command.actor, { override: command.override })];
    }
    case 'submit_request':
      return decideSubmit(state, command);
    case 'cancel_request': {
      requireProjectActor(command.actor, 'workroom_scheduler');
      const request = requireRequest(state, command.requestId);
      if (request.projectId !== command.actor.projectId) throw new Error('Workroom cannot cancel another Project request');
      if (requestStatus(state, request.id) !== 'pending') throw new Error('Only pending Capacity Requests can be cancelled');
      return [domainEvent('capacity.request_cancelled', command.actor, { requestId: request.id })];
    }
    case 'decide_admission': {
      requireRole(command.actor, 'portfolio_kernel');
      return decideAdmission(state, command.actor);
    }
    case 'consume_grant': {
      requireProjectActor(command.actor, 'workroom_kernel');
      const grant = requireGrant(state, command.grantId);
      if (grant.projectId !== command.actor.projectId) throw new Error('Workroom cannot consume another Project grant');
      if (grant.status !== 'offered') throw new Error(`Capacity Grant ${grant.id} is ${grant.status}`);
      if (grant.offerExpiresAt <= state.now) throw new Error(`Capacity Grant ${grant.id} offer expired`);
      return [domainEvent('capacity.grant_consumed', command.actor, {
        grantId: grant.id,
        assignmentRef: command.assignmentRef,
        consumedAt: state.now,
        leaseExpiresAt: state.now + state.policy.leaseTtlTicks,
      })];
    }
    case 'acknowledge_reclaim': {
      requireProjectActor(command.actor, 'workroom_kernel');
      const reclaim = requireReclaim(state, command.reclaimId);
      if (reclaim.projectId !== command.actor.projectId) throw new Error('Workroom cannot acknowledge another Project reclaim');
      if (reclaim.status !== 'pending') throw new Error(`Capacity Reclaim ${reclaim.id} is ${reclaim.status}`);
      return [domainEvent('capacity.reclaim_acknowledged', command.actor, {
        reclaimId: reclaim.id,
        outcome: command.outcome,
      })];
    }
    case 'settle_usage': {
      requireRole(command.actor, 'usage_gateway');
      const grant = requireGrant(state, command.grantId);
      if (!['consumed', 'reclaim_requested', 'usage_pending', 'usage_unknown'].includes(grant.status)) {
        throw new Error(`Capacity Grant ${grant.id} cannot settle from ${grant.status}`);
      }
      if (!Number.isSafeInteger(command.actualCostMicros) || command.actualCostMicros < 0) {
        throw new Error('actualCostMicros must be a non-negative safe integer');
      }
      return [domainEvent('capacity.usage_settled', command.actor, {
        grantId: grant.id,
        actualCostMicros: command.actualCostMicros,
        settlementRef: command.settlementRef,
      })];
    }
  }
}

function decideSubmit(
  state: PortfolioState,
  command: Extract<PortfolioCommand, { type: 'submit_request' }>,
): readonly Omit<PortfolioEvent, 'seq'>[] {
  requireProjectActor(command.actor, 'workroom_scheduler');
  assertOpaqueRequest(command.request);
  if (command.request.projectId !== command.actor.projectId) throw new Error('Scheduler actor/request Project mismatch');
  const policy = requireProjectPolicy(state, command.request.projectId);
  validateDemands(command.request.demands, policy, state.policy.pools);
  if (command.request.deadline !== undefined && command.request.deadline <= state.now) {
    throw new Error('Capacity Request deadline must be in the future');
  }
  const fingerprint = requestFingerprint(command.request);
  const existing = state.requests[command.request.id];
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error(`Capacity Request id conflict: ${command.request.id}`);
    return [];
  }
  const outstanding = Object.values(state.requests).filter((request) => (
    request.projectId === command.request.projectId
    && !request.cancelled
    && requestStatus(state, request.id) !== 'settled'
  )).length;
  if (outstanding >= policy.maxOutstandingRequests) {
    throw new Error(`Project ${policy.projectId} exceeds maxOutstandingRequests`);
  }
  return [domainEvent('capacity.request_submitted', command.actor, {
    request: {
      ...command.request,
      submittedAt: state.now,
      submittedSeq: state.sequence + 1,
      fingerprint,
      cancelled: false,
    },
  })];
}

function decideAdmission(
  state: PortfolioState,
  actor: PortfolioActor,
): readonly Omit<PortfolioEvent, 'seq'>[] {
  const heads = projectHeads(state);
  if (heads.length === 0) return [];
  const ordered = [...heads].sort((left, right) => compareCandidates(state, left, right));
  const reserved = ordered.find((request) => Object.values(state.reclaims).some((reclaim) => (
    reclaim.reservedForRequestId === request.id && reclaim.status === 'checkpointed'
  )));
  if (reserved && blockersFor(state, reserved).length === 0) return [makeGrantEvent(state, actor, reserved)];
  for (const request of ordered) {
    if (blockersFor(state, request).length === 0) return [makeGrantEvent(state, actor, request)];
  }
  for (const request of ordered) {
    const blockers = blockersFor(state, request);
    if (blockers.length > 0 && blockers.every((blocker) => blocker.startsWith('pool_capacity:'))) {
      const victim = findReclaimVictim(state, request);
      if (victim) {
        const reason = isStarved(state, request) ? 'starvation_bound' : 'higher_portfolio_priority';
        return [makeReclaimEvent(state, actor, victim, request.id, reason, 0)];
      }
    }
  }
  return [];
}

function projectHeads(state: PortfolioState): readonly CapacityRequest[] {
  const byProject = new Map<string, CapacityRequest[]>();
  for (const request of Object.values(state.requests)) {
    if (request.cancelled || requestStatus(state, request.id) !== 'pending') continue;
    const policy = requireProjectPolicy(state, request.projectId);
    if (policy.status !== 'active') continue;
    const list = byProject.get(request.projectId) ?? [];
    list.push(request);
    byProject.set(request.projectId, list);
  }
  return [...byProject.values()].map((requests) => [...requests].sort((left, right) => (
    left.workRef.localOrder - right.workRef.localOrder
    || left.submittedSeq - right.submittedSeq
    || left.id.localeCompare(right.id)
  ))[0]!);
}

function compareCandidates(state: PortfolioState, left: CapacityRequest, right: CapacityRequest): number {
  const leftPolicy = requireProjectPolicy(state, left.projectId);
  const rightPolicy = requireProjectPolicy(state, right.projectId);
  const leftStarvedAt = left.submittedAt + leftPolicy.starvationAfterTicks;
  const rightStarvedAt = right.submittedAt + rightPolicy.starvationAfterTicks;
  const leftStarved = state.now >= leftStarvedAt;
  const rightStarved = state.now >= rightStarvedAt;
  if (leftStarved !== rightStarved) return leftStarved ? -1 : 1;
  if (leftStarved && leftStarvedAt !== rightStarvedAt) return leftStarvedAt - rightStarvedAt;
  const lane = LANE_ORDER[effectiveLane(state, left)] - LANE_ORDER[effectiveLane(state, right)];
  if (lane !== 0) return lane;
  const fair = projectedDominantService(state, left) - projectedDominantService(state, right);
  if (Math.abs(fair) > Number.EPSILON) return fair;
  const deadline = (left.deadline ?? Number.POSITIVE_INFINITY) - (right.deadline ?? Number.POSITIVE_INFINITY);
  if (deadline !== 0) return deadline;
  return left.submittedSeq - right.submittedSeq || left.id.localeCompare(right.id);
}

function projectedDominantService(state: PortfolioState, request: CapacityRequest): number {
  const policy = requireProjectPolicy(state, request.projectId);
  let dominant = 0;
  for (const pool of Object.values(state.policy.pools)) {
    const historical = Object.values(state.grants)
      .filter((grant) => grant.projectId === request.projectId)
      .reduce((sum, grant) => sum + (grant.demands.find((item) => item.poolId === pool.id)?.capacityUnits ?? 0), 0);
    const requested = request.demands.find((item) => item.poolId === pool.id)?.capacityUnits ?? 0;
    dominant = Math.max(dominant, (historical + requested) / pool.capacityUnits / policy.weight);
  }
  return dominant;
}

function blockersFor(state: PortfolioState, request: CapacityRequest): readonly string[] {
  const projectPolicy = requireProjectPolicy(state, request.projectId);
  const blockers: string[] = [];
  if (projectPolicy.status !== 'active') blockers.push(`project_${projectPolicy.status}`);
  const active = Object.values(state.grants).filter((grant) => (
    grant.projectId === request.projectId && CAPACITY_HOLDING.has(grant.status)
  )).length;
  if (active >= projectPolicy.maxConcurrentGrants) blockers.push('project_concurrency');
  const reserve = reservedCost(state, request);
  const project = projectBudget(state, request.projectId);
  if (project.availableMicros < reserve) blockers.push('project_budget');
  const global = globalBudget(state);
  if (global.availableMicros < reserve) blockers.push('global_budget');
  for (const demand of request.demands) {
    const pool = state.policy.pools[demand.poolId]!;
    const capacityUsed = Object.values(state.grants)
      .filter((grant) => CAPACITY_HOLDING.has(grant.status))
      .reduce((sum, grant) => sum + (grant.demands.find((item) => item.poolId === pool.id)?.capacityUnits ?? 0), 0);
    if (capacityUsed + demand.capacityUnits > pool.capacityUnits) blockers.push(`pool_capacity:${pool.id}`);
    if (rateUsed(state, pool.id) + demand.rateUnits > pool.rateUnitsPerWindow) blockers.push(`pool_rate:${pool.id}`);
  }
  return blockers;
}

function globalBudget(state: PortfolioState): Readonly<{ spentMicros: number; reservedMicros: number; availableMicros: number }> {
  const spentMicros = Object.values(state.grants)
    .filter((grant) => grant.status === 'settled')
    .reduce((sum, grant) => sum + (grant.actualCostMicros ?? 0), 0);
  const reservedMicros = Object.values(state.grants)
    .filter((grant) => BUDGET_HOLDING.has(grant.status))
    .reduce((sum, grant) => sum + grant.reservedCostMicros, 0);
  return { spentMicros, reservedMicros, availableMicros: state.policy.globalBudgetMicros - spentMicros - reservedMicros };
}

function rateUsed(state: PortfolioState, poolId: string): number {
  const pool = state.policy.pools[poolId]!;
  const windowStart = Math.floor(state.now / pool.rateWindowTicks) * pool.rateWindowTicks;
  return Object.values(state.grants).reduce((sum, grant) => {
    const units = grant.demands.find((demand) => demand.poolId === poolId)?.rateUnits ?? 0;
    if (grant.status === 'offered') return sum + units;
    if (grant.consumedAt !== undefined && grant.consumedAt >= windowStart) return sum + units;
    return sum;
  }, 0);
}

function reservedCost(state: PortfolioState, request: CapacityRequest): number {
  return request.demands.reduce((sum, demand) => (
    sum + demand.budgetUnits * state.policy.pools[demand.poolId]!.pricePerBudgetUnitMicros
  ), 0);
}

function effectiveLane(state: PortfolioState, request: CapacityRequest): PortfolioLane {
  const override = Object.values(state.priorityOverrides).find((item) => (
    item.requestId === request.id && item.projectId === request.projectId && item.expiresAt > state.now
  ));
  return override?.lane ?? requireProjectPolicy(state, request.projectId).lane;
}

function isStarved(state: PortfolioState, request: CapacityRequest): boolean {
  return state.now >= request.submittedAt + requireProjectPolicy(state, request.projectId).starvationAfterTicks;
}

function findReclaimVictim(state: PortfolioState, candidate: CapacityRequest): CapacityGrant | undefined {
  const candidateLane = LANE_ORDER[effectiveLane(state, candidate)];
  const blockedPools = new Set(candidate.demands.map((demand) => demand.poolId));
  return Object.values(state.grants)
    .filter((grant) => {
      const request = state.requests[grant.requestId];
      if (!request || request.preemptibility !== 'checkpointable') return false;
      if (grant.status !== 'consumed' || grant.projectId === candidate.projectId) return false;
      if (!grant.demands.some((demand) => blockedPools.has(demand.poolId))) return false;
      return isStarved(state, candidate) || candidateLane < LANE_ORDER[grant.laneAtIssue];
    })
    .sort((left, right) => (
      LANE_ORDER[right.laneAtIssue] - LANE_ORDER[left.laneAtIssue]
      || right.issuedAt - left.issuedAt
      || right.id.localeCompare(left.id)
    ))[0];
}

function makeGrantEvent(
  state: PortfolioState,
  actor: PortfolioActor,
  request: CapacityRequest,
): Omit<PortfolioEvent, 'seq'> {
  const priorFence = Object.values(state.grants)
    .filter((grant) => grant.requestId === request.id)
    .reduce((maximum, grant) => Math.max(maximum, grant.fence), 0);
  return domainEvent('capacity.grant_offered', actor, {
    grant: {
      id: `grant-${state.sequence + 1}`,
      fence: priorFence + 1,
      requestId: request.id,
      projectId: request.projectId,
      demands: request.demands,
      reservedCostMicros: reservedCost(state, request),
      portfolioPolicyRevision: state.policy.revision,
      projectPolicyRevision: requireProjectPolicy(state, request.projectId).revision,
      laneAtIssue: effectiveLane(state, request),
      issuedAt: state.now,
      offerExpiresAt: state.now + state.policy.offerTtlTicks,
      status: 'offered',
    } satisfies CapacityGrant,
  });
}

function makeReclaimEvent(
  state: PortfolioState,
  actor: PortfolioActor,
  grant: CapacityGrant,
  reservedForRequestId: string | undefined,
  reason: CapacityReclaim['reason'],
  offset: number,
): Omit<PortfolioEvent, 'seq'> {
  return domainEvent('capacity.reclaim_requested', actor, {
    reclaim: {
      id: `reclaim-${state.sequence + offset + 1}`,
      grantId: grant.id,
      projectId: grant.projectId,
      ...(reservedForRequestId === undefined ? {} : { reservedForRequestId }),
      requestedAt: state.now,
      deadline: state.now + state.policy.reclaimDeadlineTicks,
      reason,
      status: 'pending',
    } satisfies CapacityReclaim,
  });
}

function evolvePortfolio(state: PortfolioState, entry: PortfolioEvent): PortfolioState {
  let next: PortfolioState = { ...state, sequence: entry.seq };
  switch (entry.type) {
    case 'portfolio.created':
      return next;
    case 'clock.advanced':
      return { ...next, now: Number(entry.payload.now) };
    case 'project.policy_updated': {
      const policy = entry.payload.policy as unknown as ProjectPortfolioPolicy;
      return { ...next, policy: { ...next.policy, projects: { ...next.policy.projects, [policy.projectId]: policy } } };
    }
    case 'priority.override_set': {
      const override = entry.payload.override as unknown as PriorityOverride;
      return { ...next, priorityOverrides: { ...next.priorityOverrides, [override.id]: override } };
    }
    case 'capacity.request_submitted': {
      const request = entry.payload.request as unknown as CapacityRequest;
      return { ...next, requests: { ...next.requests, [request.id]: request } };
    }
    case 'capacity.request_cancelled': {
      const requestId = String(entry.payload.requestId);
      const request = next.requests[requestId]!;
      return { ...next, requests: { ...next.requests, [requestId]: { ...request, cancelled: true } } };
    }
    case 'capacity.grant_offered': {
      const grant = entry.payload.grant as unknown as CapacityGrant;
      return { ...next, grants: { ...next.grants, [grant.id]: grant } };
    }
    case 'capacity.grant_consumed': {
      const grantId = String(entry.payload.grantId);
      return updateGrant(next, grantId, {
        status: 'consumed',
        assignmentRef: String(entry.payload.assignmentRef),
        consumedAt: Number(entry.payload.consumedAt),
        leaseExpiresAt: Number(entry.payload.leaseExpiresAt),
      });
    }
    case 'capacity.grant_expired':
      return updateGrant(next, String(entry.payload.grantId), { status: 'expired' });
    case 'capacity.grant_lease_lost':
      return updateGrant(next, String(entry.payload.grantId), { status: 'usage_unknown' });
    case 'capacity.usage_settled':
      return updateGrant(next, String(entry.payload.grantId), {
        status: 'settled',
        actualCostMicros: Number(entry.payload.actualCostMicros),
        settlementRef: String(entry.payload.settlementRef),
      });
    case 'capacity.reclaim_requested': {
      const reclaim = entry.payload.reclaim as unknown as CapacityReclaim;
      next = { ...next, reclaims: { ...next.reclaims, [reclaim.id]: reclaim } };
      return updateGrant(next, reclaim.grantId, { status: 'reclaim_requested' });
    }
    case 'capacity.reclaim_acknowledged': {
      const reclaimId = String(entry.payload.reclaimId);
      const outcome = String(entry.payload.outcome) as 'checkpointed' | 'declined';
      const reclaim = next.reclaims[reclaimId]!;
      next = {
        ...next,
        reclaims: { ...next.reclaims, [reclaimId]: { ...reclaim, status: outcome } },
      };
      return updateGrant(next, reclaim.grantId, { status: outcome === 'checkpointed' ? 'usage_pending' : 'consumed' });
    }
    case 'capacity.reclaim_timed_out': {
      const reclaimId = String(entry.payload.reclaimId);
      const reclaim = next.reclaims[reclaimId]!;
      next = {
        ...next,
        reclaims: { ...next.reclaims, [reclaimId]: { ...reclaim, status: 'timed_out' } },
      };
      const grant = next.grants[reclaim.grantId];
      return grant?.status === 'reclaim_requested' ? updateGrant(next, reclaim.grantId, { status: 'consumed' }) : next;
    }
  }
}

function updateGrant(state: PortfolioState, grantId: string, patch: Partial<CapacityGrant>): PortfolioState {
  const grant = state.grants[grantId];
  if (!grant) throw new Error(`Unknown Capacity Grant: ${grantId}`);
  return { ...state, grants: { ...state.grants, [grantId]: { ...grant, ...patch } } };
}

function validatePolicy(policy: PortfolioPolicySnapshot): void {
  if (policy.revision < 1 || !Number.isInteger(policy.revision)) throw new Error('Portfolio policy revision must be positive');
  if (!Number.isSafeInteger(policy.globalBudgetMicros) || policy.globalBudgetMicros < 0) throw new Error('Invalid global budget');
  if (policy.offerTtlTicks <= 0 || policy.leaseTtlTicks <= 0 || policy.reclaimDeadlineTicks <= 0) throw new Error('TTLs must be positive');
  for (const pool of Object.values(policy.pools)) {
    if (pool.capacityUnits <= 0 || pool.maxUnitsPerRequest <= 0 || pool.maxUnitsPerRequest > pool.capacityUnits) throw new Error(`Invalid pool capacity: ${pool.id}`);
    if (pool.rateUnitsPerWindow <= 0 || pool.rateWindowTicks <= 0 || pool.pricePerBudgetUnitMicros < 0) throw new Error(`Invalid pool limits: ${pool.id}`);
  }
  for (const project of Object.values(policy.projects)) validateProjectPolicy(project, policy.pools);
}

function validateProjectPolicy(
  policy: ProjectPortfolioPolicy,
  pools: Readonly<Record<string, ResourcePoolPolicy>>,
): void {
  if (policy.revision < 1 || policy.weight <= 0 || policy.maxConcurrentGrants <= 0 || policy.maxOutstandingRequests <= 0 || policy.starvationAfterTicks <= 0) {
    throw new Error(`Invalid Project Portfolio Policy: ${policy.projectId}`);
  }
  if (!Number.isSafeInteger(policy.hardBudgetMicros) || policy.hardBudgetMicros < 0) throw new Error('Invalid Project budget');
  for (const poolId of policy.allowedPools) if (!pools[poolId]) throw new Error(`Unknown allowed pool: ${poolId}`);
}

function validateDemands(
  demands: readonly ResourceDemand[],
  project: ProjectPortfolioPolicy,
  pools: Readonly<Record<string, ResourcePoolPolicy>>,
): void {
  if (demands.length === 0) throw new Error('Capacity Request needs an atomic Resource Bundle');
  const seen = new Set<string>();
  for (const demand of demands) {
    const pool = pools[demand.poolId];
    if (!pool) throw new Error(`Unknown Resource Pool: ${demand.poolId}`);
    if (!project.allowedPools.includes(demand.poolId)) throw new Error(`Project ${project.projectId} is not admitted to ${demand.poolId}`);
    if (seen.has(demand.poolId)) throw new Error(`Duplicate Resource Pool demand: ${demand.poolId}`);
    seen.add(demand.poolId);
    if (!Number.isInteger(demand.capacityUnits) || demand.capacityUnits <= 0 || demand.capacityUnits > pool.maxUnitsPerRequest) throw new Error(`Invalid capacity demand for ${demand.poolId}`);
    if (!Number.isInteger(demand.rateUnits) || demand.rateUnits <= 0 || demand.rateUnits > pool.rateUnitsPerWindow) throw new Error(`Invalid rate demand for ${demand.poolId}`);
    if (!Number.isSafeInteger(demand.budgetUnits) || demand.budgetUnits < 0) throw new Error(`Invalid budget demand for ${demand.poolId}`);
  }
}

function assertOpaqueRequest(request: object): void {
  const allowed = new Set(['id', 'projectId', 'workRef', 'demands', 'preemptibility', 'deadline']);
  const forbidden = Object.keys(request).filter((key) => !allowed.has(key));
  if (forbidden.length > 0) {
    throw new Error(`Capacity Request cannot carry Workroom context: ${forbidden.join(', ')}`);
  }
  const value = request as Partial<{
    id: unknown;
    projectId: unknown;
    workRef: Record<string, unknown>;
    demands: readonly Record<string, unknown>[];
  }>;
  const workRefKeys = new Set(['runId', 'schedulerSequence', 'localOrder', 'profileDigest']);
  const extraWorkRef = Object.keys(value.workRef ?? {}).filter((key) => !workRefKeys.has(key));
  const demandKeys = new Set(['poolId', 'capacityUnits', 'rateUnits', 'budgetUnits']);
  const extraDemand = (value.demands ?? []).flatMap((demand) => Object.keys(demand).filter((key) => !demandKeys.has(key)));
  if (extraWorkRef.length > 0 || extraDemand.length > 0) {
    throw new Error(`Capacity Request cannot carry nested Workroom context: ${[...extraWorkRef, ...extraDemand].join(', ')}`);
  }
  for (const [label, identifier] of [
    ['request id', value.id],
    ['project id', value.projectId],
    ['run id', value.workRef?.runId],
  ] as const) {
    if (typeof identifier !== 'string' || identifier.length === 0 || identifier.length > 256) {
      throw new Error(`Invalid opaque ${label}`);
    }
  }
  if (typeof value.workRef?.profileDigest !== 'string' || !value.workRef.profileDigest.startsWith('sha256:') || value.workRef.profileDigest.length > 256) {
    throw new Error('Invalid Profile digest');
  }
  if (!Number.isSafeInteger(value.workRef.schedulerSequence) || !Number.isSafeInteger(value.workRef.localOrder)) {
    throw new Error('Invalid Workroom scheduler order');
  }
}

function requestFingerprint(request: {
  id: string; projectId: string; workRef: WorkRef; demands: readonly ResourceDemand[];
  preemptibility: GrantPreemptibility; deadline?: number;
}): string {
  return JSON.stringify({
    projectId: request.projectId,
    workRef: request.workRef,
    demands: [...request.demands].sort((left, right) => left.poolId.localeCompare(right.poolId)),
    preemptibility: request.preemptibility,
    deadline: request.deadline ?? null,
  });
}

function requireRole(actor: PortfolioActor, role: PortfolioActor['role']): void {
  if (actor.role !== role) throw new Error(`${role} authority required`);
}

function requireProjectActor(actor: PortfolioActor, role: 'workroom_scheduler' | 'workroom_kernel'): void {
  requireRole(actor, role);
  if (!actor.projectId) throw new Error(`${role} requires a trusted Project scope`);
}

function requireProjectPolicy(state: PortfolioState, projectId: string): ProjectPortfolioPolicy {
  const policy = state.policy.projects[projectId];
  if (!policy) throw new Error(`Unknown Project Portfolio Policy: ${projectId}`);
  return policy;
}

function requireRequest(state: PortfolioState, requestId: string): CapacityRequest {
  const request = state.requests[requestId];
  if (!request) throw new Error(`Unknown Capacity Request: ${requestId}`);
  return request;
}

function requireGrant(state: PortfolioState, grantId: string): CapacityGrant {
  const grant = state.grants[grantId];
  if (!grant) throw new Error(`Unknown Capacity Grant: ${grantId}`);
  return grant;
}

function requireReclaim(state: PortfolioState, reclaimId: string): CapacityReclaim {
  const reclaim = state.reclaims[reclaimId];
  if (!reclaim) throw new Error(`Unknown Capacity Reclaim: ${reclaimId}`);
  return reclaim;
}

function domainEvent(
  type: PortfolioEvent['type'],
  actor: PortfolioActor,
  payload: Readonly<Record<string, unknown>>,
): Omit<PortfolioEvent, 'seq'> {
  return { type, actor, payload };
}

function event(
  seq: number,
  type: PortfolioEvent['type'],
  actor: PortfolioActor,
  payload: Readonly<Record<string, unknown>>,
): PortfolioEvent {
  return { seq, type, actor, payload };
}
