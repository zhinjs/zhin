import {
  PortfolioSequenceConflictError,
  parsePortfolioCapacityRequest,
  parsePortfolioPolicySnapshot,
  parsePortfolioProjectPolicy,
  parsePortfolioResourceBundle,
  type PortfolioCapacityGrant,
  type PortfolioCapacityReclaim,
  type PortfolioCapacityRequest,
  type PortfolioFact,
  type PortfolioFactDraft,
  type PortfolioGovernanceProof,
  type PortfolioGrantAssignmentFailureReason,
  type PortfolioJournalRepository,
  type PortfolioKernelCommandAuthority,
  type PortfolioLane,
  type PortfolioPolicySnapshot,
  type PortfolioPriorityOverride,
  type PortfolioProjectPolicy,
  type PortfolioClockAuthority,
  type PortfolioUsageGatewayAuthority,
  type PortfolioValidatedBundleAuthority,
} from './portfolio-journal.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface PortfolioRequestState {
  readonly request: PortfolioCapacityRequest;
  readonly bundleAuthority: PortfolioValidatedBundleAuthority;
  readonly requestedAt: number;
  readonly requestedSequence: number;
}

export interface PortfolioAdmissionState {
  readonly portfolioId: string;
  readonly sequence: number;
  readonly now: number;
  readonly clockSequence: number;
  readonly clockDigest?: string;
  readonly usageSettlementCursor: number;
  readonly policy?: PortfolioPolicySnapshot;
  readonly requests: Readonly<Record<string, PortfolioRequestState>>;
  readonly grants: Readonly<Record<string, PortfolioCapacityGrant>>;
  readonly reclaims: Readonly<Record<string, PortfolioCapacityReclaim>>;
  readonly overrides: Readonly<Record<string, PortfolioPriorityOverride>>;
  readonly normalizedService: Readonly<Record<string, number>>;
  readonly normalizedAtSequence: number;
}

export interface PortfolioAdmissionApplicationOptions {
  readonly portfolioId: string;
  readonly repository: PortfolioJournalRepository;
  readonly ids: Readonly<{ eventId(type: PortfolioFact['type'], identity: string): string }>;
  readonly maxCasAttempts?: number;
}

const CAPACITY_HOLDING: ReadonlySet<PortfolioCapacityGrant['status']> = new Set([
  'offered', 'consumed', 'reclaim_requested',
]);
const BUDGET_HOLDING: ReadonlySet<PortfolioCapacityGrant['status']> = new Set([
  'offered', 'consumed', 'reclaim_requested', 'usage_pending', 'usage_unknown',
]);
const LANE_ORDER: Readonly<Record<PortfolioLane, number>> = {
  urgent: 0, high: 1, normal: 2, low: 3,
};

/** Journal-backed Portfolio resource authority. It never writes Workroom facts. */
export class PortfolioAdmissionApplication {
  readonly #maxCasAttempts: number;

  constructor(readonly options: PortfolioAdmissionApplicationOptions) {
    this.#maxCasAttempts = options.maxCasAttempts ?? 3;
  }

  async read(): Promise<PortfolioAdmissionState> {
    return replayPortfolioAdmission(this.options.portfolioId, await this.options.repository.read(
      this.options.portfolioId,
    ));
  }

  async pinPolicy(policy: PortfolioPolicySnapshot, governance: PortfolioGovernanceProof): Promise<void> {
    const canonical = parsePortfolioPolicySnapshot(policy);
    assertGovernance(governance, canonical.digest, 0);
    await this.#commit(state => {
      if (state.policy) {
        if (state.policy.digest === canonical.digest) return [];
        throw new Error('Portfolio Policy is already pinned');
      }
      return [this.#draft('portfolio.policy_pinned', canonical.digest, state.now, {
        policy: canonical,
        governance,
      })];
    });
  }

  async updateProjectPolicy(
    policy: PortfolioProjectPolicy,
    governance: PortfolioGovernanceProof,
  ): Promise<void> {
    await this.updateProjectPolicies([policy], { [policy.projectId]: governance });
  }

  async updateProjectPolicies(
    policies: readonly PortfolioProjectPolicy[],
    governance: Readonly<Record<string, PortfolioGovernanceProof>>,
  ): Promise<void> {
    const canonical = policies.map(parsePortfolioProjectPolicy)
      .sort((left, right) => compareCanonicalWorkroomText(left.projectId, right.projectId));
    if (canonical.length === 0 || new Set(canonical.map(policy => policy.projectId)).size !== canonical.length) {
      throw new Error('Portfolio Project Policy atomic batch is empty or duplicated');
    }
    await this.#commit(state => {
      const portfolio = requirePolicy(state);
      let previousBudget = 0;
      let candidateBudget = 0;
      for (const candidate of canonical) {
        const previous = portfolio.projects[candidate.projectId];
        if (!previous || candidate.revision !== previous.revision + 1) {
          throw new Error('Portfolio Project Policy revision is stale');
        }
        previousBudget += previous.hardBudgetMicros;
        candidateBudget += candidate.hardBudgetMicros;
        assertGovernance(governance[candidate.projectId], digest(candidate), previous.revision);
      }
      if (previousBudget !== candidateBudget) {
        throw new Error('Portfolio Project Policy budget transfer must conserve its exact batch total');
      }
      return canonical.map(candidate => this.#draft(
        'project.policy_updated', `${candidate.projectId}:${candidate.revision}`, state.now,
        { policy: candidate, governance: governance[candidate.projectId]! },
      ));
    });
  }

  async setPriorityOverride(
    override: PortfolioPriorityOverride,
    governance: PortfolioGovernanceProof,
  ): Promise<void> {
    await this.#commit(state => {
      const policy = requirePolicy(state);
      const request = requireRequest(state, override.requestId).request;
      const project = policy.projects[override.projectId];
      if (!project || request.projectId !== override.projectId
        || request.payloadDigest !== override.requestPayloadDigest
        || override.policyRevision !== project.revision
        || override.expiresAt <= state.now) {
        throw new Error('Portfolio Priority Override exact request/policy scope is stale');
      }
      assertGovernance(governance, digest(override), project.revision);
      const existing = state.overrides[override.overrideId];
      if (existing) {
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(override)) {
          throw new Error('Portfolio Priority Override identity conflict');
        }
        return [];
      }
      return [this.#draft('priority.override_set', override.overrideId, state.now, {
        override,
        governance,
      })];
    });
  }

  async submit(
    request: PortfolioCapacityRequest,
    bundleAuthority: PortfolioValidatedBundleAuthority,
  ): Promise<void> {
    const canonical = parsePortfolioCapacityRequest(request);
    await this.#commit(state => {
      const policy = requirePolicy(state);
      const project = policy.projects[canonical.projectId];
      if (!project || project.revision !== canonical.projectPolicyRevision) {
        throw new Error('Capacity Request Project Policy revision is stale');
      }
      assertBundleAuthority(canonical, bundleAuthority, policy);
      const existing = state.requests[canonical.requestId];
      if (existing) {
        if (canonicalWorkroomJson(existing.request) !== canonicalWorkroomJson(canonical)
          || canonicalWorkroomJson(existing.bundleAuthority) !== canonicalWorkroomJson(bundleAuthority)) {
          throw new Error('Capacity Request identity conflict');
        }
        return [];
      }
      const outstanding = Object.values(state.requests).filter(item =>
        item.request.projectId === canonical.projectId
        && portfolioRequestStatus(state, item.request.requestId) !== 'settled').length;
      if (outstanding >= project.maxOutstandingRequests) {
        throw new Error('Capacity Request exceeds Project outstanding cap');
      }
      return [this.#draft('capacity.requested', canonical.requestId, state.now, {
        request: canonical,
        bundleAuthority,
      })];
    });
  }

  async decideAdmission(): Promise<PortfolioCapacityGrant | null> {
    let offered: PortfolioCapacityGrant | null = null;
    await this.#commit(state => {
      offered = null;
      const decision = decideAdmission(state);
      if (!decision) return [];
      if ('reclaimId' in decision) {
        return [this.#draft('capacity.reclaim_requested', decision.reclaimId, state.now, {
          reclaim: decision,
        })];
      }
      offered = decision;
      return [this.#draft('capacity.grant_offered', decision.grantId, state.now, {
        grant: decision,
      })];
    });
    return offered;
  }

  async consume(input: Readonly<{
    grantId: string; projectId: string; fence: number; assignmentRef: string;
  }>, authority: PortfolioKernelCommandAuthority): Promise<void> {
    await this.#commit(state => {
      const policy = requirePolicy(state);
      const grant = requireGrant(state, input.grantId);
      if (grant.status === 'consumed' && grant.projectId === input.projectId
        && grant.fence === input.fence && grant.assignmentRef === input.assignmentRef) {
        assertKernelAuthority(this.options.portfolioId, grant, authority, {
          action: 'consume', assignmentRef: input.assignmentRef,
        });
        return [];
      }
      if (grant.projectId !== input.projectId || grant.fence !== input.fence
        || grant.status !== 'offered' || grant.offerExpiresAt <= state.now) {
        throw new Error('Capacity Grant consume scope/fence/offer is stale');
      }
      assertKernelAuthority(this.options.portfolioId, grant, authority, {
        action: 'consume', assignmentRef: input.assignmentRef,
      });
      return [this.#draft('capacity.grant_consumed', `${grant.grantId}:${grant.fence}`, state.now, {
        grantId: grant.grantId,
        projectId: grant.projectId,
        fence: grant.fence,
        assignmentRef: input.assignmentRef,
        consumedAt: state.now,
        leaseExpiresAt: state.now + policy.leaseTtlTicks,
        maxLeaseExpiresAt: state.now + policy.maxLeaseQuantumTicks,
        authority,
      })];
    });
  }

  async failAssignment(input: Readonly<{
    grantId: string; projectId: string; fence: number; assignmentRef: string;
    reason: PortfolioGrantAssignmentFailureReason; kernelSequence: number; kernelFactDigest: string;
  }>, authority: PortfolioKernelCommandAuthority): Promise<void> {
    await this.#commit(state => {
      const grant = requireGrant(state, input.grantId);
      const action = {
        action: 'assignment_failed' as const,
        assignmentRef: input.assignmentRef,
        failureReason: input.reason,
        kernelSequence: input.kernelSequence,
        kernelFactDigest: input.kernelFactDigest,
      };
      if (grant.status === 'assignment_failed' && grant.projectId === input.projectId
        && grant.fence === input.fence && grant.assignmentRef === input.assignmentRef) {
        assertKernelAuthority(this.options.portfolioId, grant, authority, action);
        return [];
      }
      if (grant.status !== 'consumed' || grant.projectId !== input.projectId
        || grant.fence !== input.fence || grant.assignmentRef !== input.assignmentRef) {
        throw new Error('Capacity Grant Assignment failure scope/fence/status is stale');
      }
      assertKernelAuthority(this.options.portfolioId, grant, authority, action);
      return [this.#draft('capacity.grant_assignment_failed',
        `${grant.grantId}:${grant.fence}:${input.assignmentRef}`, state.now, {
          ...input, failedAt: state.now, authority,
        })];
    });
  }

  async renewLease(input: Readonly<{
    grantId: string; projectId: string; fence: number; assignmentRef: string; heartbeatSequence: number;
  }>, authority: PortfolioKernelCommandAuthority): Promise<void> {
    await this.#commit(state => {
      const policy = requirePolicy(state);
      const grant = requireGrant(state, input.grantId);
      const action = renewalAuthorityAction(state, policy, input.assignmentRef, input.heartbeatSequence);
      if (grant.status === 'consumed' && grant.projectId === input.projectId
        && grant.fence === input.fence && grant.assignmentRef === input.assignmentRef
        && grant.lastHeartbeatSequence === input.heartbeatSequence) {
        assertKernelAuthority(this.options.portfolioId, grant, authority, action);
        return [];
      }
      if (grant.status !== 'consumed' || grant.projectId !== input.projectId
        || grant.fence !== input.fence || grant.assignmentRef !== input.assignmentRef
        || grant.leaseExpiresAt === undefined || grant.leaseExpiresAt <= state.now
        || grant.maxLeaseExpiresAt === undefined) {
        throw new Error('Capacity Grant Lease renewal scope/fence/status is stale');
      }
      if (state.clockSequence < 0 || !state.clockDigest) {
        throw new Error('Capacity Grant Lease renewal requires a current Portfolio clock fact');
      }
      const previousHeartbeatSequence = grant.lastHeartbeatSequence ?? 0;
      const previousHeartbeatAt = grant.lastHeartbeatAt ?? grant.consumedAt!;
      const renewalCount = grant.renewalCount ?? 0;
      if (input.heartbeatSequence !== previousHeartbeatSequence + 1
        || state.now < previousHeartbeatAt + policy.leaseHeartbeatTicks) {
        throw new Error('Capacity Grant Lease heartbeat sequence/time is stale');
      }
      if (renewalCount >= policy.maxLeaseRenewals) {
        throw new Error('Capacity Grant Lease renewal limit is exhausted');
      }
      const pendingReclaim = Object.values(state.reclaims).some(reclaim => reclaim.status === 'pending');
      const starvedReservation = Object.values(state.requests).some(item =>
        portfolioRequestStatus(state, item.request.requestId) === 'pending'
        && state.now >= item.request.starvationAt);
      if (pendingReclaim || starvedReservation) {
        throw new Error('Capacity Grant Lease renewal is reserved for reclaim/starvation');
      }
      const leaseExpiresAt = Math.min(state.now + policy.leaseTtlTicks, grant.maxLeaseExpiresAt);
      if (leaseExpiresAt <= grant.leaseExpiresAt) {
        throw new Error('Capacity Grant Lease max quantum is exhausted');
      }
      assertKernelAuthority(this.options.portfolioId, grant, authority, action);
      return [this.#draft('capacity.grant_lease_renewed',
        `${grant.grantId}:${grant.fence}:${input.heartbeatSequence}`, state.now, {
          grantId: grant.grantId,
          projectId: grant.projectId,
          fence: grant.fence,
          assignmentRef: input.assignmentRef,
          heartbeatSequence: input.heartbeatSequence,
          renewedAt: state.now,
          previousLeaseExpiresAt: grant.leaseExpiresAt,
          leaseExpiresAt,
          maxLeaseExpiresAt: grant.maxLeaseExpiresAt,
          policyDigest: policy.digest,
          clockSequence: state.clockSequence,
          clockDigest: state.clockDigest,
          usageSettlementCursor: state.usageSettlementCursor,
          authority,
        })];
    });
  }

  async acknowledgeReclaim(input: Readonly<{
    reclaimId: string; projectId: string; fence: number;
    outcome: 'checkpointed' | 'declined'; checkpointRef?: string; checkpointDigest?: string;
  }>, authority: PortfolioKernelCommandAuthority): Promise<void> {
    await this.#commit(state => {
      const reclaim = requireReclaim(state, input.reclaimId);
      const grant = requireGrant(state, reclaim.grantId);
      if (reclaim.status === input.outcome && reclaim.projectId === input.projectId
        && grant.fence === input.fence) {
        if (reclaim.checkpointRef !== input.checkpointRef
          || reclaim.checkpointDigest !== input.checkpointDigest) {
          throw new Error('Capacity Reclaim checkpoint idempotency drift');
        }
        assertKernelAuthority(this.options.portfolioId, grant, authority, {
          action: 'reclaim_acknowledge', assignmentRef: grant.assignmentRef!,
          reclaimId: reclaim.reclaimId, outcome: input.outcome,
          ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
          ...(input.checkpointDigest === undefined ? {} : { checkpointDigest: input.checkpointDigest }),
        });
        return [];
      }
      if (reclaim.status !== 'pending' || reclaim.projectId !== input.projectId
        || grant.fence !== input.fence || grant.status !== 'reclaim_requested') {
        throw new Error('Capacity Reclaim acknowledgement scope/fence is stale');
      }
      if (input.outcome === 'checkpointed' && (!input.checkpointRef || !input.checkpointDigest)) {
        throw new Error('Checkpointed Capacity Reclaim requires checkpoint ref/digest');
      }
      if (input.outcome === 'declined' && (input.checkpointRef || input.checkpointDigest)) {
        throw new Error('Declined Capacity Reclaim cannot claim a checkpoint');
      }
      assertKernelAuthority(this.options.portfolioId, grant, authority, {
        action: 'reclaim_acknowledge', assignmentRef: grant.assignmentRef!,
        reclaimId: reclaim.reclaimId, outcome: input.outcome,
        ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
        ...(input.checkpointDigest === undefined ? {} : { checkpointDigest: input.checkpointDigest }),
      });
      return [this.#draft('capacity.reclaim_acknowledged', reclaim.reclaimId, state.now, {
        reclaimId: reclaim.reclaimId,
        grantId: grant.grantId,
        projectId: grant.projectId,
        fence: grant.fence,
        outcome: input.outcome,
        ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
        ...(input.checkpointDigest === undefined ? {} : { checkpointDigest: input.checkpointDigest }),
        authority,
      })];
    });
  }

  async settleUsage(authority: PortfolioUsageGatewayAuthority): Promise<void> {
    await this.#commit(state => {
      const grant = requireGrant(state, authority.grantId);
      assertUsageAuthority(this.options.portfolioId, grant, authority);
      if (grant.fence !== authority.fence
        || !['consumed', 'reclaim_requested', 'usage_pending', 'usage_unknown'].includes(grant.status)) {
        if (grant.status === 'settled'
          && grant.actualCostMicros === authority.actualCostMicros
          && grant.settlementRef === authority.settlementRef
          && grant.receiptId === authority.receiptId
          && grant.receiptDigest === authority.receiptDigest
          && grant.authenticatedBy === authority.authenticatedBy) return [];
        throw new Error('Capacity Usage Receipt scope/fence/status is stale');
      }
      if (!Number.isSafeInteger(authority.actualCostMicros) || authority.actualCostMicros < 0) {
        throw new Error('Capacity Usage actual cost is invalid');
      }
      return [this.#draft('capacity.usage_settled', authority.receiptId, state.now, {
        receiptId: authority.receiptId,
        grantId: authority.grantId,
        fence: authority.fence,
        actualCostMicros: authority.actualCostMicros,
        settlementRef: authority.settlementRef,
        authenticatedBy: authority.authenticatedBy,
        authority,
      })];
    });
  }

  async advanceClock(authority: PortfolioClockAuthority): Promise<void> {
    await this.#commit(state => {
      assertClockAuthority(this.options.portfolioId, authority);
      const { now } = authority;
      if (!Number.isSafeInteger(now) || now <= state.now) throw new Error('Portfolio clock must advance');
      const drafts: PortfolioFactDraft[] = [this.#draft('clock.advanced', String(now), now, { now, authority })];
      for (const grant of Object.values(state.grants)) {
        if (grant.status === 'offered' && grant.offerExpiresAt <= now) {
          drafts.push(this.#draft('capacity.grant_expired', `${grant.grantId}:${grant.fence}`, now, {
            grantId: grant.grantId, fence: grant.fence,
          }));
        } else if ((grant.status === 'consumed' || grant.status === 'reclaim_requested')
          && grant.leaseExpiresAt !== undefined && grant.leaseExpiresAt <= now) {
          drafts.push(this.#draft('capacity.grant_lease_lost', `${grant.grantId}:${grant.fence}`, now, {
            grantId: grant.grantId, fence: grant.fence, usage: 'unknown',
          }));
        }
      }
      for (const reclaim of Object.values(state.reclaims)) {
        if (reclaim.status === 'pending' && reclaim.deadline <= now) {
          const grant = requireGrant(state, reclaim.grantId);
          drafts.push(this.#draft('capacity.reclaim_timed_out', reclaim.reclaimId, now, {
            reclaimId: reclaim.reclaimId, grantId: grant.grantId, fence: grant.fence,
          }));
        }
      }
      return drafts;
    });
  }

  async normalizeService(divisor: number): Promise<void> {
    await this.#commit(state => {
      if (!Number.isSafeInteger(divisor) || divisor < 2) {
        throw new Error('Portfolio service normalization divisor must be at least two');
      }
      const projectService: Record<string, number> = {};
      for (const projectId of Object.keys(requirePolicy(state).projects).sort()) {
        projectService[projectId] = Math.floor(dominantService(state, projectId) / divisor);
      }
      const normalizationId = `normalization:${state.sequence + 1}`;
      return [this.#draft('service.normalized', normalizationId, state.now, {
        normalization: { normalizationId, divisor, projectService },
      })];
    });
  }

  async #commit(decide: (state: PortfolioAdmissionState) => readonly PortfolioFactDraft[]): Promise<void> {
    for (let attempt = 1; attempt <= this.#maxCasAttempts; attempt += 1) {
      const state = await this.read();
      const drafts = decide(state);
      if (drafts.length === 0) return;
      try {
        await this.options.repository.append(this.options.portfolioId, state.sequence, drafts);
        return;
      } catch (error) {
        if (!(error instanceof PortfolioSequenceConflictError) || attempt === this.#maxCasAttempts) throw error;
      }
    }
    throw new Error('Portfolio admission CAS retry loop exhausted');
  }

  #draft<Type extends PortfolioFact['type']>(
    type: Type,
    identity: string,
    occurredAt: number,
    payload: Extract<PortfolioFact, { type: Type }>['payload'],
  ): PortfolioFactDraft {
    return {
      eventId: this.options.ids.eventId(type, identity),
      occurredAt,
      type,
      payload,
    };
  }
}

export function replayPortfolioAdmission(
  portfolioId: string,
  facts: readonly PortfolioFact[],
): PortfolioAdmissionState {
  let state: PortfolioAdmissionState = deepFreeze({
    portfolioId, sequence: -1, now: 0,
    clockSequence: -1, usageSettlementCursor: -1,
    requests: {}, grants: {}, reclaims: {}, overrides: {},
    normalizedService: {}, normalizedAtSequence: -1,
  });
  for (const [index, fact] of facts.entries()) {
    if (fact.portfolioId !== portfolioId || fact.sequence !== index) {
      throw new Error('Portfolio Journal replay sequence/scope drift');
    }
    state = evolve(state, fact);
  }
  return deepFreeze(state);
}

export function portfolioRequestStatus(
  state: PortfolioAdmissionState,
  requestId: string,
): 'pending' | 'granted' | 'usage_blocked' | 'settled' {
  requireRequest(state, requestId);
  const highestFenceGrant = Object.values(state.grants)
    .filter(grant => grant.requestId === requestId)
    .sort((left, right) => right.fence - left.fence)[0];
  if (!highestFenceGrant || highestFenceGrant.status === 'expired'
    || highestFenceGrant.status === 'assignment_failed') return 'pending';
  if (highestFenceGrant.status === 'settled') return 'settled';
  if (highestFenceGrant.status === 'usage_pending' || highestFenceGrant.status === 'usage_unknown') {
    return 'usage_blocked';
  }
  return 'granted';
}

export function portfolioProjectBudget(state: PortfolioAdmissionState, projectId: string) {
  const project = requirePolicy(state).projects[projectId];
  if (!project) throw new Error(`Unknown Portfolio Project ${projectId}`);
  const grants = Object.values(state.grants).filter(grant => grant.projectId === projectId);
  const spentMicros = grants.filter(grant => grant.status === 'settled')
    .reduce((sum, grant) => sum + (grant.actualCostMicros ?? 0), 0);
  const reservedMicros = grants.filter(grant => BUDGET_HOLDING.has(grant.status))
    .reduce((sum, grant) => sum + grant.reservedCostMicros, 0);
  return deepFreeze({
    limitMicros: project.hardBudgetMicros,
    spentMicros,
    reservedMicros,
    availableMicros: project.hardBudgetMicros - spentMicros - reservedMicros,
  });
}

export function portfolioRequestBlockers(
  state: PortfolioAdmissionState,
  requestId: string,
): readonly string[] {
  return Object.freeze(blockers(state, requireRequest(state, requestId)));
}

function evolve(state: PortfolioAdmissionState, fact: PortfolioFact): PortfolioAdmissionState {
  let next = { ...state, sequence: fact.sequence };
  switch (fact.type) {
    case 'portfolio.policy_pinned':
      if (state.policy) throw new Error('Portfolio Policy fact is duplicated');
      assertGovernance(fact.payload.governance, fact.payload.policy.digest, 0);
      return { ...next, policy: fact.payload.policy };
    case 'project.policy_updated': {
      const current = requirePolicy(state);
      const previous = current.projects[fact.payload.policy.projectId];
      if (!previous || fact.payload.policy.revision !== previous.revision + 1) {
        throw new Error('Persisted Portfolio Project Policy revision drift');
      }
      assertGovernance(fact.payload.governance, digest(fact.payload.policy), previous.revision);
      return {
        ...next,
        policy: {
          ...current,
          projects: { ...current.projects, [fact.payload.policy.projectId]: fact.payload.policy },
        },
      };
    }
    case 'priority.override_set': {
      const request = requireRequest(state, fact.payload.override.requestId).request;
      const project = requirePolicy(state).projects[fact.payload.override.projectId];
      if (!project || request.payloadDigest !== fact.payload.override.requestPayloadDigest
        || fact.payload.override.policyRevision !== project.revision) {
        throw new Error('Persisted Portfolio Priority Override scope drift');
      }
      assertGovernance(fact.payload.governance, digest(fact.payload.override), project.revision);
      return { ...next, overrides: { ...state.overrides, [fact.payload.override.overrideId]: fact.payload.override } };
    }
    case 'capacity.requested': {
      if (!fact.payload.bundleAuthority) throw new Error('Production Capacity Request lacks validated Bundle authority');
      assertBundleAuthority(fact.payload.request, fact.payload.bundleAuthority, requirePolicy(state));
      return {
        ...next,
        requests: {
          ...state.requests,
          [fact.payload.request.requestId]: {
            request: fact.payload.request,
            bundleAuthority: fact.payload.bundleAuthority,
            requestedAt: fact.occurredAt,
            requestedSequence: fact.sequence,
          },
        },
      };
    }
    case 'capacity.grant_offered': {
      const item = requireRequest(state, fact.payload.grant.requestId);
      assertGrantMatchesRequest(fact.payload.grant, item, state);
      if (fact.payload.grant.issuedSequence !== fact.sequence) {
        throw new Error('Capacity Grant offered sequence drift');
      }
      return { ...next, grants: { ...state.grants, [fact.payload.grant.grantId]: fact.payload.grant } };
    }
    case 'capacity.grant_consumed': {
      const grant = requireGrant(state, fact.payload.grantId);
      const policy = requirePolicy(state);
      if (grant.status !== 'offered' || grant.projectId !== fact.payload.projectId
        || grant.fence !== fact.payload.fence || grant.offerExpiresAt <= fact.payload.consumedAt
        || fact.payload.leaseExpiresAt !== fact.payload.consumedAt + policy.leaseTtlTicks
        || fact.payload.maxLeaseExpiresAt !== fact.payload.consumedAt + policy.maxLeaseQuantumTicks) {
        throw new Error('Persisted Capacity Grant consume drift');
      }
      assertKernelAuthority(state.portfolioId, grant, fact.payload.authority, {
        action: 'consume', assignmentRef: fact.payload.assignmentRef,
      });
      return updateGrant(next, grant.grantId, {
        status: 'consumed', assignmentRef: fact.payload.assignmentRef,
        consumedAt: fact.payload.consumedAt, leaseExpiresAt: fact.payload.leaseExpiresAt,
        maxLeaseExpiresAt: fact.payload.maxLeaseExpiresAt,
        renewalCount: 0, lastHeartbeatSequence: 0, lastHeartbeatAt: fact.payload.consumedAt,
      });
    }
    case 'capacity.grant_assignment_failed': {
      const grant = requireFence(state, fact.payload.grantId, fact.payload.fence);
      const action = {
        action: 'assignment_failed' as const,
        assignmentRef: fact.payload.assignmentRef,
        failureReason: fact.payload.reason,
        kernelSequence: fact.payload.kernelSequence,
        kernelFactDigest: fact.payload.kernelFactDigest,
      };
      if (grant.status !== 'consumed' || grant.projectId !== fact.payload.projectId
        || grant.assignmentRef !== fact.payload.assignmentRef) {
        throw new Error('Persisted Capacity Grant Assignment failure drift');
      }
      assertKernelAuthority(state.portfolioId, grant, fact.payload.authority, action);
      return updateGrant(next, grant.grantId, { status: 'assignment_failed' });
    }
    case 'capacity.grant_lease_renewed': {
      const grant = requireFence(state, fact.payload.grantId, fact.payload.fence);
      const policy = requirePolicy(state);
      const action = renewalAuthorityAction(
        state, policy, fact.payload.assignmentRef, fact.payload.heartbeatSequence,
      );
      const pendingReclaim = Object.values(state.reclaims).some(reclaim => reclaim.status === 'pending');
      const starvedReservation = Object.values(state.requests).some(item =>
        portfolioRequestStatus(state, item.request.requestId) === 'pending'
        && state.now >= item.request.starvationAt);
      if (grant.status !== 'consumed' || grant.projectId !== fact.payload.projectId
        || grant.assignmentRef !== fact.payload.assignmentRef
        || grant.leaseExpiresAt !== fact.payload.previousLeaseExpiresAt
        || grant.maxLeaseExpiresAt !== fact.payload.maxLeaseExpiresAt
        || fact.payload.heartbeatSequence !== (grant.lastHeartbeatSequence ?? 0) + 1
        || fact.payload.renewedAt !== state.now
        || fact.payload.renewedAt < (grant.lastHeartbeatAt ?? grant.consumedAt!) + policy.leaseHeartbeatTicks
        || fact.payload.policyDigest !== policy.digest
        || fact.payload.clockSequence !== state.clockSequence
        || fact.payload.clockDigest !== state.clockDigest
        || fact.payload.usageSettlementCursor !== state.usageSettlementCursor
        || fact.payload.leaseExpiresAt !== Math.min(state.now + policy.leaseTtlTicks, fact.payload.maxLeaseExpiresAt)
        || (grant.renewalCount ?? 0) >= policy.maxLeaseRenewals
        || pendingReclaim || starvedReservation) {
        throw new Error('Persisted Capacity Grant Lease renewal drift');
      }
      assertKernelAuthority(state.portfolioId, grant, fact.payload.authority, action);
      return updateGrant(next, grant.grantId, {
        leaseExpiresAt: fact.payload.leaseExpiresAt,
        renewalCount: (grant.renewalCount ?? 0) + 1,
        lastHeartbeatSequence: fact.payload.heartbeatSequence,
        lastHeartbeatAt: fact.payload.renewedAt,
      });
    }
    case 'capacity.grant_expired': {
      const grant = requireFence(state, fact.payload.grantId, fact.payload.fence);
      if (grant.status !== 'offered') throw new Error('Only an offered Capacity Grant can expire');
      return updateGrant(next, grant.grantId, { status: 'expired' });
    }
    case 'capacity.grant_lease_lost': {
      const grant = requireFence(state, fact.payload.grantId, fact.payload.fence);
      if (grant.status !== 'consumed' && grant.status !== 'reclaim_requested') {
        throw new Error('Only a consumed Capacity Grant can lose its lease');
      }
      return updateGrant(next, grant.grantId, { status: 'usage_unknown' });
    }
    case 'capacity.usage_settled': {
      const grant = requireFence(state, fact.payload.grantId, fact.payload.fence);
      assertUsageAuthority(state.portfolioId, grant, fact.payload.authority);
      if (fact.payload.authenticatedBy !== fact.payload.authority.authenticatedBy) {
        throw new Error('Persisted Usage Gateway authenticator drift');
      }
      if (!['consumed', 'reclaim_requested', 'usage_pending', 'usage_unknown'].includes(grant.status)) {
        throw new Error('Persisted Capacity Usage settlement status drift');
      }
      return updateGrant({ ...next, usageSettlementCursor: fact.sequence }, grant.grantId, {
        status: 'settled', actualCostMicros: fact.payload.actualCostMicros,
        settlementRef: fact.payload.settlementRef,
        receiptId: fact.payload.receiptId,
        receiptDigest: fact.payload.authority.receiptDigest,
        authenticatedBy: fact.payload.authenticatedBy,
      });
    }
    case 'capacity.reclaim_requested': {
      const grant = requireGrant(state, fact.payload.reclaim.grantId);
      const request = requireRequest(state, grant.requestId).request;
      const candidate = fact.payload.reclaim.reservedForRequestId === undefined
        ? undefined
        : requireRequest(state, fact.payload.reclaim.reservedForRequestId);
      if (grant.status !== 'consumed' || request.preemptibility !== 'checkpointable'
        || !candidate
        || canonicalWorkroomJson(createReclaim(state, grant, candidate))
          !== canonicalWorkroomJson(fact.payload.reclaim)) {
        throw new Error('Persisted Capacity Reclaim attempts to preempt atomic/stale work');
      }
      next = { ...next, reclaims: { ...state.reclaims, [fact.payload.reclaim.reclaimId]: fact.payload.reclaim } };
      return updateGrant(next, grant.grantId, { status: 'reclaim_requested' });
    }
    case 'capacity.reclaim_acknowledged': {
      const reclaim = requireReclaim(state, fact.payload.reclaimId);
      const grant = requireFence(state, fact.payload.grantId, fact.payload.fence);
      if (reclaim.status !== 'pending' || reclaim.projectId !== fact.payload.projectId) {
        throw new Error('Persisted Capacity Reclaim acknowledgement drift');
      }
      assertKernelAuthority(state.portfolioId, grant, fact.payload.authority, {
        action: 'reclaim_acknowledge', assignmentRef: grant.assignmentRef!,
        reclaimId: reclaim.reclaimId, outcome: fact.payload.outcome,
        ...(fact.payload.checkpointRef === undefined ? {} : { checkpointRef: fact.payload.checkpointRef }),
        ...(fact.payload.checkpointDigest === undefined ? {} : { checkpointDigest: fact.payload.checkpointDigest }),
      });
      next = {
        ...next,
        reclaims: {
          ...state.reclaims,
          [reclaim.reclaimId]: {
            ...reclaim,
            status: fact.payload.outcome,
            ...(fact.payload.checkpointRef === undefined ? {} : { checkpointRef: fact.payload.checkpointRef }),
            ...(fact.payload.checkpointDigest === undefined ? {} : { checkpointDigest: fact.payload.checkpointDigest }),
          },
        },
      };
      return updateGrant(next, grant.grantId, {
        status: fact.payload.outcome === 'checkpointed' ? 'usage_pending' : 'consumed',
      });
    }
    case 'capacity.reclaim_timed_out': {
      const reclaim = requireReclaim(state, fact.payload.reclaimId);
      const grant = requireFence(state, fact.payload.grantId, fact.payload.fence);
      next = {
        ...next,
        reclaims: { ...state.reclaims, [reclaim.reclaimId]: { ...reclaim, status: 'timed_out' } },
      };
      return grant.status === 'reclaim_requested'
        ? updateGrant(next, grant.grantId, { status: 'consumed' })
        : next;
    }
    case 'clock.advanced':
      assertClockAuthority(state.portfolioId, fact.payload.authority);
      if (fact.payload.authority.now !== fact.payload.now) {
        throw new Error('Persisted Portfolio clock authority time drift');
      }
      if (fact.payload.now <= state.now) throw new Error('Persisted Portfolio clock did not advance');
      return {
        ...next,
        now: fact.payload.now,
        clockSequence: fact.sequence,
        clockDigest: fact.payload.authority.clockDigest,
      };
    case 'service.normalized':
      return {
        ...next,
        normalizedService: fact.payload.normalization.projectService,
        normalizedAtSequence: fact.sequence,
      };
  }
}

function decideAdmission(state: PortfolioAdmissionState): PortfolioCapacityGrant | PortfolioCapacityReclaim | null {
  const heads = projectHeads(state).sort((left, right) => compareRequests(state, left, right));
  for (const head of heads) {
    if (blockers(state, head).length === 0) return createGrant(state, head);
  }
  for (const head of heads) {
    const blocked = blockers(state, head);
    if (blocked.length > 0 && blocked.every(item => item.startsWith('capacity:'))) {
      const victim = reclaimVictim(state, head);
      if (victim) return createReclaim(state, victim, head);
    }
  }
  return null;
}

function projectHeads(state: PortfolioAdmissionState): PortfolioRequestState[] {
  const byProject = new Map<string, PortfolioRequestState[]>();
  for (const request of Object.values(state.requests)) {
    if (portfolioRequestStatus(state, request.request.requestId) !== 'pending') continue;
    if (requirePolicy(state).projects[request.request.projectId]?.status !== 'active') continue;
    const entries = byProject.get(request.request.projectId) ?? [];
    entries.push(request);
    byProject.set(request.request.projectId, entries);
  }
  return [...byProject.values()].map(entries => entries.sort((left, right) =>
    left.request.localOrder - right.request.localOrder
    || left.request.schedulerSequence - right.request.schedulerSequence
    || compareCanonicalWorkroomText(left.request.requestId, right.request.requestId))[0]!);
}

function compareRequests(state: PortfolioAdmissionState, left: PortfolioRequestState, right: PortfolioRequestState): number {
  const leftStarved = state.now >= left.request.starvationAt;
  const rightStarved = state.now >= right.request.starvationAt;
  if (leftStarved !== rightStarved) return leftStarved ? -1 : 1;
  if (leftStarved && left.request.starvationAt !== right.request.starvationAt) {
    return left.request.starvationAt - right.request.starvationAt;
  }
  const lane = LANE_ORDER[effectiveLane(state, left.request)] - LANE_ORDER[effectiveLane(state, right.request)];
  if (lane !== 0) return lane;
  const service = projectedDominantService(state, left) - projectedDominantService(state, right);
  if (service !== 0) return service;
  const deadline = (left.request.deadlineAt ?? Number.POSITIVE_INFINITY)
    - (right.request.deadlineAt ?? Number.POSITIVE_INFINITY);
  if (deadline !== 0) return deadline;
  return left.request.schedulerSequence - right.request.schedulerSequence
    || compareCanonicalWorkroomText(left.request.requestId, right.request.requestId);
}

function blockers(state: PortfolioAdmissionState, request: PortfolioRequestState): string[] {
  const policy = requirePolicy(state);
  const project = policy.projects[request.request.projectId]!;
  const result: string[] = [];
  if (project.status !== 'active') result.push(`project:${project.status}`);
  const active = Object.values(state.grants).filter(grant => grant.projectId === project.projectId
    && CAPACITY_HOLDING.has(grant.status));
  if (active.length >= project.maxConcurrentGrants) result.push('project:concurrency');
  const burst = Object.values(state.grants).filter(grant => grant.projectId === project.projectId
    && grant.issuedAt === state.now).length;
  if (burst >= project.burstLimit) result.push('project:burst');
  const reserved = request.bundleAuthority.reservedCostMicros;
  if (portfolioProjectBudget(state, project.projectId).availableMicros < reserved) result.push('project:budget');
  if (portfolioGlobalBudget(state).availableMicros < reserved) result.push('global:budget');
  for (const demand of request.request.resourceBundle.demands) {
    const pool = policy.pools[demand.poolId]!;
    const used = Object.values(state.grants).filter(grant => CAPACITY_HOLDING.has(grant.status))
      .reduce((sum, grant) => sum
        + (grant.resourceBundle.demands.find(item => item.poolId === demand.poolId)?.capacityUnits ?? 0), 0);
    if (used + demand.capacityUnits > pool.capacityUnits) result.push(`capacity:${demand.poolId}`);
    if (rateUsed(state, demand.poolId) + demand.rateUnits > pool.rateUnitsPerWindow) {
      result.push(`rate:${demand.poolId}`);
    }
  }
  return result;
}

function createGrant(state: PortfolioAdmissionState, request: PortfolioRequestState): PortfolioCapacityGrant {
  const policy = requirePolicy(state);
  const authority = request.bundleAuthority;
  const fence = Object.values(state.grants).filter(grant => grant.requestId === request.request.requestId)
    .reduce((highest, grant) => Math.max(highest, grant.fence), 0) + 1;
  return deepFreeze({
    grantId: `capacity-grant:${encodeURIComponent(request.request.requestId)}:${fence}`,
    requestId: request.request.requestId,
    projectId: request.request.projectId,
    fence,
    resourceBundle: request.request.resourceBundle,
    requestDigest: authority.requestDigest,
    resourceBundleDigest: authority.resourceBundleDigest,
    catalogGenerationId: authority.catalogGenerationId,
    catalogRevision: authority.catalogRevision,
    catalogDigest: authority.catalogDigest,
    profileRevisionId: authority.profileRevisionId,
    profileDigest: authority.profileDigest,
    profileCeilingDigest: authority.profileCeilingDigest,
    validatedBundleDigest: authority.validatedBundleDigest,
    reservedCostMicros: authority.reservedCostMicros,
    portfolioPolicyRevision: policy.revision,
    portfolioPolicyDigest: policy.digest,
    projectPolicyRevision: policy.projects[request.request.projectId]!.revision,
    lane: effectiveLane(state, request.request),
    issuedAt: state.now,
    issuedSequence: state.sequence + 1,
    offerExpiresAt: state.now + policy.offerTtlTicks,
    status: 'offered',
  });
}

function reclaimVictim(state: PortfolioAdmissionState, candidate: PortfolioRequestState): PortfolioCapacityGrant | undefined {
  const candidateLane = LANE_ORDER[effectiveLane(state, candidate.request)];
  const pools = new Set(candidate.request.resourceBundle.demands.map(item => item.poolId));
  return Object.values(state.grants).filter(grant => {
    const request = state.requests[grant.requestId]?.request;
    return grant.status === 'consumed'
      && request?.preemptibility === 'checkpointable'
      && grant.projectId !== candidate.request.projectId
      && grant.resourceBundle.demands.some(item => pools.has(item.poolId))
      && (state.now >= candidate.request.starvationAt || candidateLane < LANE_ORDER[grant.lane]);
  }).sort((left, right) => LANE_ORDER[right.lane] - LANE_ORDER[left.lane]
    || right.issuedAt - left.issuedAt || compareCanonicalWorkroomText(right.grantId, left.grantId))[0];
}

function createReclaim(
  state: PortfolioAdmissionState,
  grant: PortfolioCapacityGrant,
  candidate: PortfolioRequestState,
): PortfolioCapacityReclaim {
  return deepFreeze({
    reclaimId: `capacity-reclaim:${encodeURIComponent(grant.grantId)}:${grant.fence}`,
    grantId: grant.grantId,
    projectId: grant.projectId,
    reservedForRequestId: candidate.request.requestId,
    requestedAt: state.now,
    deadline: state.now + requirePolicy(state).reclaimTtlTicks,
    reason: state.now >= candidate.request.starvationAt ? 'starvation_bound' : 'higher_portfolio_priority',
    status: 'pending',
  });
}

function projectedDominantService(state: PortfolioAdmissionState, request: PortfolioRequestState): number {
  const project = requirePolicy(state).projects[request.request.projectId]!;
  let dominant = (state.normalizedService[project.projectId] ?? 0) / 1_000_000;
  for (const pool of Object.values(requirePolicy(state).pools)) {
    const historical = Object.values(state.grants)
      .filter(grant => grant.projectId === project.projectId
        && grant.status !== 'expired'
        && grant.issuedSequence > state.normalizedAtSequence)
      .reduce((sum, grant) => sum
        + (grant.resourceBundle.demands.find(item => item.poolId === pool.poolId)?.capacityUnits ?? 0), 0);
    const requested = request.request.resourceBundle.demands
      .find(item => item.poolId === pool.poolId)?.capacityUnits ?? 0;
    dominant = Math.max(dominant, (historical + requested) / pool.capacityUnits / project.weight);
  }
  return dominant;
}

function dominantService(state: PortfolioAdmissionState, projectId: string): number {
  const project = requirePolicy(state).projects[projectId];
  if (!project) throw new Error(`Unknown Portfolio Project ${projectId}`);
  let dominant = (state.normalizedService[projectId] ?? 0) / 1_000_000;
  for (const pool of Object.values(requirePolicy(state).pools)) {
    const historical = Object.values(state.grants)
      .filter(grant => grant.projectId === projectId && grant.status !== 'expired'
        && grant.issuedSequence > state.normalizedAtSequence)
      .reduce((sum, grant) => sum
        + (grant.resourceBundle.demands.find(item => item.poolId === pool.poolId)?.capacityUnits ?? 0), 0);
    dominant = Math.max(dominant, historical / pool.capacityUnits / project.weight);
  }
  return Math.floor(dominant * 1_000_000);
}

function effectiveLane(state: PortfolioAdmissionState, request: PortfolioCapacityRequest): PortfolioLane {
  const override = Object.values(state.overrides).find(item =>
    item.requestId === request.requestId && item.projectId === request.projectId
    && item.requestPayloadDigest === request.payloadDigest && item.expiresAt > state.now);
  return override?.lane ?? requirePolicy(state).projects[request.projectId]!.lane;
}

function rateUsed(state: PortfolioAdmissionState, poolId: string): number {
  const pool = requirePolicy(state).pools[poolId]!;
  const start = Math.floor(state.now / pool.rateWindowTicks) * pool.rateWindowTicks;
  return Object.values(state.grants).reduce((sum, grant) => {
    const units = grant.resourceBundle.demands.find(item => item.poolId === poolId)?.rateUnits ?? 0;
    if (grant.status === 'offered') return sum + units;
    if (grant.consumedAt !== undefined && grant.consumedAt >= start) return sum + units;
    return sum;
  }, 0);
}

function portfolioGlobalBudget(state: PortfolioAdmissionState) {
  const grants = Object.values(state.grants);
  const spentMicros = grants.filter(grant => grant.status === 'settled')
    .reduce((sum, grant) => sum + (grant.actualCostMicros ?? 0), 0);
  const reservedMicros = grants.filter(grant => BUDGET_HOLDING.has(grant.status))
    .reduce((sum, grant) => sum + grant.reservedCostMicros, 0);
  return {
    spentMicros, reservedMicros,
    availableMicros: requirePolicy(state).globalBudgetMicros - spentMicros - reservedMicros,
  };
}

function assertBundleAuthority(
  request: PortfolioCapacityRequest,
  authority: PortfolioValidatedBundleAuthority,
  policy: PortfolioPolicySnapshot,
): void {
  if (authority.requestDigest !== portfolioCapacityRequestDigest(request)
    || authority.resourceBundleDigest !== digest(parsePortfolioResourceBundle(request.resourceBundle))
    || authority.profileRevisionId !== request.workRef.profileRevisionId
    || authority.profileDigest !== request.workRef.profileDigest
    || authority.reservedCostMicros !== reservedCost(policy, request)
    || authority.validatedBundleDigest !== portfolioValidatedBundleDigest(authority)) {
    throw new Error('Validated Atomic Resource Bundle authority/request drift');
  }
  const project = policy.projects[request.projectId];
  if (!project || request.resourceBundle.demands.some(demand => !project.allowedPools.includes(demand.poolId))) {
    throw new Error('Validated Atomic Resource Bundle is outside Portfolio Project Policy');
  }
}

function assertGrantMatchesRequest(
  grant: PortfolioCapacityGrant,
  request: PortfolioRequestState,
  state: PortfolioAdmissionState,
): void {
  const authority = request.bundleAuthority;
  const policy = requirePolicy(state);
  const fence = Object.values(state.grants).filter(item => item.requestId === request.request.requestId)
    .reduce((highest, item) => Math.max(highest, item.fence), 0) + 1;
  if (grant.status !== 'offered'
    || grant.grantId !== `capacity-grant:${encodeURIComponent(request.request.requestId)}:${fence}`
    || grant.fence !== fence
    || grant.requestId !== request.request.requestId
    || grant.projectId !== request.request.projectId
    || grant.requestDigest !== authority.requestDigest
    || grant.resourceBundleDigest !== authority.resourceBundleDigest
    || grant.validatedBundleDigest !== authority.validatedBundleDigest
    || grant.catalogGenerationId !== authority.catalogGenerationId
    || grant.catalogRevision !== authority.catalogRevision
    || grant.catalogDigest !== authority.catalogDigest
    || grant.profileRevisionId !== authority.profileRevisionId
    || grant.profileDigest !== authority.profileDigest
    || grant.profileCeilingDigest !== authority.profileCeilingDigest
    || grant.reservedCostMicros !== authority.reservedCostMicros
    || grant.portfolioPolicyRevision !== policy.revision
    || grant.portfolioPolicyDigest !== policy.digest
    || grant.projectPolicyRevision !== policy.projects[grant.projectId]?.revision
    || grant.lane !== effectiveLane(state, request.request)
    || grant.issuedAt !== state.now
    || grant.offerExpiresAt !== state.now + policy.offerTtlTicks
    || canonicalWorkroomJson(grant.resourceBundle) !== canonicalWorkroomJson(request.request.resourceBundle)) {
    throw new Error('Capacity Grant drifted from validated Atomic Resource Bundle');
  }
}

export function portfolioCapacityRequestDigest(request: PortfolioCapacityRequest): string {
  return digest(parsePortfolioCapacityRequest(request));
}

export function portfolioValidatedBundleDigest(
  authority: Omit<PortfolioValidatedBundleAuthority, 'validatedBundleDigest'> | PortfolioValidatedBundleAuthority,
): string {
  const { validatedBundleDigest: _ignored, ...claims } = authority as PortfolioValidatedBundleAuthority;
  return digest(claims);
}

function reservedCost(policy: PortfolioPolicySnapshot, request: PortfolioCapacityRequest): number {
  return request.resourceBundle.demands.reduce((sum, demand) => {
    const price = policy.pools[demand.poolId]?.priceMicrosPerBudgetUnit;
    if (price === undefined) throw new Error(`Unknown Portfolio Resource Pool ${demand.poolId}`);
    const cost = demand.budgetUnits * price;
    if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(sum + cost)) {
      throw new Error('Portfolio budget reservation overflows');
    }
    return sum + cost;
  }, 0);
}

function assertGovernance(
  proof: PortfolioGovernanceProof,
  targetDigest: string,
  expectedRevision: number,
): void {
  if (!proof || proof.targetDigest !== targetDigest || proof.expectedRevision !== expectedRevision
    || !proof.principalId || !proof.authorizedBy
    || !/^sha256:[a-f0-9]{64}$/u.test(proof.reasonDigest)) {
    throw new Error('Portfolio Governance proof scope/revision is stale');
  }
}

type KernelAuthorityClaims = Omit<PortfolioKernelCommandAuthority, 'commandDigest' | 'authorizedBy'>;
type UsageAuthorityClaims = Omit<PortfolioUsageGatewayAuthority, 'receiptDigest' | 'authenticatedBy'>;
type ClockAuthorityClaims = Omit<PortfolioClockAuthority, 'clockDigest' | 'authorizedBy'>;

export function portfolioKernelCommandDigest(claims: KernelAuthorityClaims): string {
  return digest(claims);
}

export function portfolioUsageReceiptDigest(claims: UsageAuthorityClaims): string {
  return digest(claims);
}

export function portfolioClockDigest(claims: ClockAuthorityClaims): string {
  return digest(claims);
}

function assertKernelAuthority(
  portfolioId: string,
  grant: PortfolioCapacityGrant,
  authority: PortfolioKernelCommandAuthority,
  action: Readonly<{
    action: PortfolioKernelCommandAuthority['action']; assignmentRef: string;
    reclaimId?: string; outcome?: 'checkpointed' | 'declined'; checkpointRef?: string; checkpointDigest?: string;
    heartbeatSequence?: number; clockSequence?: number; clockDigest?: string;
    policyDigest?: string; usageSettlementCursor?: number;
    failureReason?: PortfolioGrantAssignmentFailureReason;
    kernelSequence?: number; kernelFactDigest?: string;
  }>,
): void {
  const claims: KernelAuthorityClaims = {
    portfolioId: authority.portfolioId,
    action: authority.action,
    projectId: authority.projectId,
    requestId: authority.requestId,
    grantId: authority.grantId,
    fence: authority.fence,
    assignmentRef: authority.assignmentRef,
    ...(authority.reclaimId === undefined ? {} : { reclaimId: authority.reclaimId }),
    ...(authority.outcome === undefined ? {} : { outcome: authority.outcome }),
    ...(authority.checkpointRef === undefined ? {} : { checkpointRef: authority.checkpointRef }),
    ...(authority.checkpointDigest === undefined ? {} : { checkpointDigest: authority.checkpointDigest }),
    ...(authority.heartbeatSequence === undefined ? {} : { heartbeatSequence: authority.heartbeatSequence }),
    ...(authority.clockSequence === undefined ? {} : { clockSequence: authority.clockSequence }),
    ...(authority.clockDigest === undefined ? {} : { clockDigest: authority.clockDigest }),
    ...(authority.policyDigest === undefined ? {} : { policyDigest: authority.policyDigest }),
    ...(authority.usageSettlementCursor === undefined
      ? {}
      : { usageSettlementCursor: authority.usageSettlementCursor }),
    ...(authority.failureReason === undefined ? {} : { failureReason: authority.failureReason }),
    ...(authority.kernelSequence === undefined ? {} : { kernelSequence: authority.kernelSequence }),
    ...(authority.kernelFactDigest === undefined ? {} : { kernelFactDigest: authority.kernelFactDigest }),
  };
  const expected: KernelAuthorityClaims = {
    portfolioId,
    action: action.action,
    projectId: grant.projectId,
    requestId: grant.requestId,
    grantId: grant.grantId,
    fence: grant.fence,
    assignmentRef: action.assignmentRef,
    ...(action.reclaimId === undefined ? {} : { reclaimId: action.reclaimId }),
    ...(action.outcome === undefined ? {} : { outcome: action.outcome }),
    ...(action.checkpointRef === undefined ? {} : { checkpointRef: action.checkpointRef }),
    ...(action.checkpointDigest === undefined ? {} : { checkpointDigest: action.checkpointDigest }),
    ...(action.heartbeatSequence === undefined ? {} : { heartbeatSequence: action.heartbeatSequence }),
    ...(action.clockSequence === undefined ? {} : { clockSequence: action.clockSequence }),
    ...(action.clockDigest === undefined ? {} : { clockDigest: action.clockDigest }),
    ...(action.policyDigest === undefined ? {} : { policyDigest: action.policyDigest }),
    ...(action.usageSettlementCursor === undefined
      ? {}
      : { usageSettlementCursor: action.usageSettlementCursor }),
    ...(action.failureReason === undefined ? {} : { failureReason: action.failureReason }),
    ...(action.kernelSequence === undefined ? {} : { kernelSequence: action.kernelSequence }),
    ...(action.kernelFactDigest === undefined ? {} : { kernelFactDigest: action.kernelFactDigest }),
  };
  if (!authority.authorizedBy || canonicalWorkroomJson(claims) !== canonicalWorkroomJson(expected)
    || authority.commandDigest !== portfolioKernelCommandDigest(claims)) {
    throw new Error('Owning Workroom Kernel command authority scope is stale');
  }
}

function renewalAuthorityAction(
  state: PortfolioAdmissionState,
  policy: PortfolioPolicySnapshot,
  assignmentRef: string,
  heartbeatSequence: number,
) {
  if (state.clockSequence < 0 || !state.clockDigest) {
    throw new Error('Capacity Grant Lease renewal requires a current Portfolio clock fact');
  }
  return {
    action: 'renew' as const,
    assignmentRef,
    heartbeatSequence,
    clockSequence: state.clockSequence,
    clockDigest: state.clockDigest,
    policyDigest: policy.digest,
    usageSettlementCursor: state.usageSettlementCursor,
  };
}

function assertUsageAuthority(
  portfolioId: string,
  grant: PortfolioCapacityGrant,
  authority: PortfolioUsageGatewayAuthority,
): void {
  const claims: UsageAuthorityClaims = {
    portfolioId: authority.portfolioId,
    receiptId: authority.receiptId,
    requestId: authority.requestId,
    grantId: authority.grantId,
    fence: authority.fence,
    actualCostMicros: authority.actualCostMicros,
    settlementRef: authority.settlementRef,
  };
  if (!authority.authenticatedBy || authority.portfolioId !== portfolioId
    || authority.requestId !== grant.requestId || authority.grantId !== grant.grantId
    || authority.fence !== grant.fence
    || authority.receiptDigest !== portfolioUsageReceiptDigest(claims)) {
    throw new Error('Usage Gateway receipt authority scope is stale');
  }
}

function assertClockAuthority(portfolioId: string, authority: PortfolioClockAuthority): void {
  const claims: ClockAuthorityClaims = { portfolioId: authority.portfolioId, now: authority.now };
  if (!authority.authorizedBy || authority.portfolioId !== portfolioId
    || authority.clockDigest !== portfolioClockDigest(claims)) {
    throw new Error('Portfolio Kernel clock authority scope is stale');
  }
}

function requirePolicy(state: PortfolioAdmissionState): PortfolioPolicySnapshot {
  if (!state.policy) throw new Error('Portfolio Policy authority is unavailable');
  return state.policy;
}

function requireRequest(state: PortfolioAdmissionState, requestId: string): PortfolioRequestState {
  const request = state.requests[requestId];
  if (!request) throw new Error(`Unknown Capacity Request ${requestId}`);
  return request;
}

function requireGrant(state: PortfolioAdmissionState, grantId: string): PortfolioCapacityGrant {
  const grant = state.grants[grantId];
  if (!grant) throw new Error(`Unknown Capacity Grant ${grantId}`);
  return grant;
}

function requireFence(state: PortfolioAdmissionState, grantId: string, fence: number): PortfolioCapacityGrant {
  const grant = requireGrant(state, grantId);
  if (grant.fence !== fence) throw new Error('Capacity Grant fence is stale');
  return grant;
}

function requireReclaim(state: PortfolioAdmissionState, reclaimId: string): PortfolioCapacityReclaim {
  const reclaim = state.reclaims[reclaimId];
  if (!reclaim) throw new Error(`Unknown Capacity Reclaim ${reclaimId}`);
  return reclaim;
}

function updateGrant(
  state: PortfolioAdmissionState,
  grantId: string,
  patch: Partial<PortfolioCapacityGrant>,
): PortfolioAdmissionState {
  return {
    ...state,
    grants: { ...state.grants, [grantId]: { ...requireGrant(state, grantId), ...patch } },
  };
}
