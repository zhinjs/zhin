import { createToken } from '@zhin.js/plugin-runtime';
import {
  PortfolioAdmissionApplication,
  portfolioCapacityRequestDigest,
  portfolioValidatedBundleDigest,
  type PortfolioAdmissionState,
} from '../portfolio/portfolio-admission.js';
import {
  parsePortfolioResourceBundle,
  type PortfolioCapacityGrant,
  type PortfolioCapacityRequest,
  type PortfolioClockAuthority,
  type PortfolioGovernanceProof,
  type PortfolioGrantAssignmentFailureReason,
  type PortfolioJournalRepository,
  type PortfolioKernelCommandAuthority,
  type PortfolioPolicySnapshot,
  type PortfolioUsageGatewayAuthority,
  type PortfolioValidatedBundleAuthority,
} from '../portfolio/portfolio-journal.js';
import type { ValidatedAtomicResourceBundle } from '../portfolio/resource-bundle.js';
import {
  canonicalWorkroomJson,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface PortfolioPolicyAuthorityPort {
  resolve(portfolioId: string): Promise<Readonly<{
    policy: PortfolioPolicySnapshot;
    governance: PortfolioGovernanceProof;
  }> | undefined>;
}

export interface PortfolioAtomicBundleAuthorityPort {
  validate(input: WorkroomSchedulerCapacityRequest): Promise<ValidatedAtomicResourceBundle | undefined>;
}

export interface PortfolioKernelCommandAuthorityPort {
  authorize(input: Readonly<{
    generation: number;
    portfolioId: string;
    action: 'consume' | 'assignment_failed' | 'reclaim_acknowledge' | 'renew';
    grant: PortfolioCapacityGrant;
    assignmentRef: string;
    reclaimId?: string;
    outcome?: 'checkpointed' | 'declined';
    checkpointRef?: string;
    checkpointDigest?: string;
    heartbeatSequence?: number;
    clockSequence?: number;
    clockDigest?: string;
    policyDigest?: string;
    usageSettlementCursor?: number;
    failureReason?: PortfolioGrantAssignmentFailureReason;
    kernelSequence?: number;
    kernelFactDigest?: string;
  }>): Promise<PortfolioKernelCommandAuthority | undefined>;
}

export interface PortfolioUsageGatewayAuthorityPort {
  authenticate(input: Readonly<{
    generation: number;
    portfolioId: string;
    receiptId: string;
    grant: PortfolioCapacityGrant;
    actualCostMicros: number;
    settlementRef: string;
  }>): Promise<PortfolioUsageGatewayAuthority | undefined>;
}

export interface PortfolioClockAuthorityPort {
  read(input: Readonly<{ generation: number; portfolioId: string }>): Promise<PortfolioClockAuthority | undefined>;
}

export interface WorkroomSchedulerCapacityRequest {
  readonly generation: number;
  readonly portfolioId: string;
  readonly tenantId: string;
  readonly catalogRevision: number;
  readonly catalogDigest: string;
  readonly capacityRequest: PortfolioCapacityRequest;
}

/** Minimal Scheduler boundary. It carries identities and resource quantities, never Task/Run content. */
export interface WorkroomSchedulerCapacityRequestPort {
  request(input: WorkroomSchedulerCapacityRequest): Promise<PortfolioCapacityGrant | null>;
}

export const portfolioJournalRepositoryToken = createToken<PortfolioJournalRepository>(
  'zhin.agent.portfolio-journal-repository',
  'Durable content-free Portfolio policy/capacity/usage Journal',
);

export const portfolioPolicyAuthorityToken = createToken<PortfolioPolicyAuthorityPort>(
  'zhin.agent.portfolio-policy-authority',
  'Persistent exact Portfolio Sponsor policy authority',
);

export const portfolioAtomicBundleAuthorityToken = createToken<PortfolioAtomicBundleAuthorityPort>(
  'zhin.agent.portfolio-atomic-bundle-authority',
  'Current generation Catalog/Profile validated Atomic Resource Bundle authority',
);

export const portfolioKernelCommandAuthorityToken = createToken<PortfolioKernelCommandAuthorityPort>(
  'zhin.agent.portfolio-kernel-command-authority',
  'Owning Workroom Kernel Capacity consume/reclaim authority',
);

export const portfolioUsageGatewayAuthorityToken = createToken<PortfolioUsageGatewayAuthorityPort>(
  'zhin.agent.portfolio-usage-gateway-authority',
  'Authenticated provider usage receipt authority',
);

export const portfolioClockAuthorityToken = createToken<PortfolioClockAuthorityPort>(
  'zhin.agent.portfolio-clock-authority',
  'Monotonic Portfolio Kernel clock authority',
);

export const workroomSchedulerCapacityRequestToken = createToken<WorkroomSchedulerCapacityRequestPort>(
  'zhin.agent.workroom-scheduler-capacity-request',
  'Generation-owned Workroom Scheduler Portfolio Capacity Request boundary',
);

export const portfolioCapacityRuntimeToken = createToken<GenerationOwnedPortfolioCapacityRuntime>(
  'zhin.agent.portfolio-capacity-runtime',
  'Generation-owned durable Portfolio admission/grant/reclaim runtime',
);

export interface GenerationOwnedPortfolioCapacityRuntimeOptions {
  readonly generation: number;
  readonly repository: PortfolioJournalRepository;
  readonly policyAuthority: PortfolioPolicyAuthorityPort;
  readonly bundleAuthority: PortfolioAtomicBundleAuthorityPort;
  readonly kernelAuthority: PortfolioKernelCommandAuthorityPort;
  readonly usageAuthority: PortfolioUsageGatewayAuthorityPort;
  readonly clockAuthority: PortfolioClockAuthorityPort;
}

export class GenerationOwnedPortfolioCapacityRuntime implements WorkroomSchedulerCapacityRequestPort {
  readonly #generation: number;
  readonly #applications = new Map<string, PortfolioAdmissionApplication>();

  constructor(readonly options: GenerationOwnedPortfolioCapacityRuntimeOptions) {
    if (!Number.isSafeInteger(options.generation) || options.generation < 0) {
      throw new Error('Portfolio runtime generation is invalid');
    }
    this.#generation = options.generation;
  }

  async request(input: WorkroomSchedulerCapacityRequest): Promise<PortfolioCapacityGrant | null> {
    this.#assertGeneration(input.generation);
    const application = this.#application(input.portfolioId);
    const policyAuthority = await this.options.policyAuthority.resolve(input.portfolioId);
    if (!policyAuthority) throw new Error('Portfolio Policy authority is unavailable');
    const state = await application.read();
    if (!state.policy) {
      await application.pinPolicy(policyAuthority.policy, policyAuthority.governance);
    } else if (state.policy.revision !== policyAuthority.policy.revision
      || state.policy.digest !== policyAuthority.policy.digest) {
      throw new Error('Portfolio Policy authority drifted from the durable pinned revision');
    }
    const validated = await this.options.bundleAuthority.validate(input);
    if (!validated) throw new Error('Portfolio Catalog/Profile Atomic Bundle authority is unavailable');
    const authority = createPortfolioValidatedBundleAuthority(input, validated);
    await application.submit(input.capacityRequest, authority);
    return await application.decideAdmission();
  }

  async consume(input: Readonly<{
    generation: number; portfolioId: string; grantId: string; projectId: string;
    fence: number; assignmentRef: string;
  }>): Promise<void> {
    this.#assertGeneration(input.generation);
    const application = this.#application(input.portfolioId);
    const grant = this.#grant(await application.read(), input.grantId);
    const authority = await this.options.kernelAuthority.authorize({
      generation: this.#generation, portfolioId: input.portfolioId, action: 'consume',
      grant, assignmentRef: input.assignmentRef,
    });
    if (!authority) throw new Error('Owning Workroom Kernel consume authority is unavailable');
    await application.consume(input, authority);
  }

  async failAssignment(input: Readonly<{
    generation: number; portfolioId: string; grantId: string; projectId: string;
    fence: number; assignmentRef: string; reason: PortfolioGrantAssignmentFailureReason;
    kernelSequence: number; kernelFactDigest: string;
  }>): Promise<void> {
    this.#assertGeneration(input.generation);
    const application = this.#application(input.portfolioId);
    const grant = this.#grant(await application.read(), input.grantId);
    const authority = await this.options.kernelAuthority.authorize({
      generation: this.#generation, portfolioId: input.portfolioId, action: 'assignment_failed',
      grant, assignmentRef: input.assignmentRef, failureReason: input.reason,
      kernelSequence: input.kernelSequence, kernelFactDigest: input.kernelFactDigest,
    });
    if (!authority) throw new Error('Owning Workroom Kernel Assignment failure authority is unavailable');
    await application.failAssignment({
      grantId: input.grantId, projectId: input.projectId, fence: input.fence,
      assignmentRef: input.assignmentRef, reason: input.reason,
      kernelSequence: input.kernelSequence, kernelFactDigest: input.kernelFactDigest,
    }, authority);
  }

  async settleUsage(input: Readonly<{
    generation: number; portfolioId: string; receiptId: string; grantId: string;
    actualCostMicros: number; settlementRef: string;
  }>): Promise<void> {
    this.#assertGeneration(input.generation);
    const application = this.#application(input.portfolioId);
    const grant = this.#grant(await application.read(), input.grantId);
    const authority = await this.options.usageAuthority.authenticate({
      generation: this.#generation, portfolioId: input.portfolioId,
      receiptId: input.receiptId, grant, actualCostMicros: input.actualCostMicros,
      settlementRef: input.settlementRef,
    });
    if (!authority) throw new Error('Usage Gateway receipt authority is unavailable');
    await application.settleUsage(authority);
  }

  async acknowledgeReclaim(input: Readonly<{
    generation: number; portfolioId: string; reclaimId: string; projectId: string;
    fence: number; outcome: 'checkpointed' | 'declined'; checkpointRef?: string; checkpointDigest?: string;
  }>): Promise<void> {
    this.#assertGeneration(input.generation);
    const application = this.#application(input.portfolioId);
    const state = await application.read();
    const reclaim = state.reclaims[input.reclaimId];
    if (!reclaim) throw new Error(`Unknown Portfolio Capacity Reclaim ${input.reclaimId}`);
    const grant = this.#grant(state, reclaim.grantId);
    if (!grant.assignmentRef) throw new Error('Capacity Reclaim Grant has no owning Assignment');
    const authority = await this.options.kernelAuthority.authorize({
      generation: this.#generation, portfolioId: input.portfolioId,
      action: 'reclaim_acknowledge', grant, assignmentRef: grant.assignmentRef,
      reclaimId: input.reclaimId, outcome: input.outcome,
      ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
      ...(input.checkpointDigest === undefined ? {} : { checkpointDigest: input.checkpointDigest }),
    });
    if (!authority) throw new Error('Owning Workroom Kernel reclaim authority is unavailable');
    await application.acknowledgeReclaim(input, authority);
  }

  async renewLease(input: Readonly<{
    generation: number; portfolioId: string; grantId: string; projectId: string;
    fence: number; assignmentRef: string; heartbeatSequence: number;
  }>): Promise<void> {
    this.#assertGeneration(input.generation);
    const application = this.#application(input.portfolioId);
    const state = await application.read();
    const grant = this.#grant(state, input.grantId);
    if (!state.policy || state.clockSequence < 0 || !state.clockDigest) {
      throw new Error('Portfolio Lease renewal policy/clock authority is unavailable');
    }
    const authority = await this.options.kernelAuthority.authorize({
      generation: this.#generation,
      portfolioId: input.portfolioId,
      action: 'renew',
      grant,
      assignmentRef: input.assignmentRef,
      heartbeatSequence: input.heartbeatSequence,
      clockSequence: state.clockSequence,
      clockDigest: state.clockDigest,
      policyDigest: state.policy.digest,
      usageSettlementCursor: state.usageSettlementCursor,
    });
    if (!authority) throw new Error('Owning Workroom Kernel Lease renewal authority is unavailable');
    await application.renewLease(input, authority);
  }

  async advanceClock(portfolioId: string): Promise<void> {
    const authority = await this.options.clockAuthority.read({ generation: this.#generation, portfolioId });
    if (!authority) throw new Error('Portfolio Kernel clock authority is unavailable');
    await this.#application(portfolioId).advanceClock(authority);
  }

  #application(portfolioId: string): PortfolioAdmissionApplication {
    if (!portfolioId.trim() || portfolioId !== portfolioId.trim()) throw new Error('Portfolio id is invalid');
    let application = this.#applications.get(portfolioId);
    if (!application) {
      application = new PortfolioAdmissionApplication({
        portfolioId,
        repository: this.options.repository,
        ids: { eventId: (type, identity) => `${type}:${encodeURIComponent(identity)}` },
      });
      this.#applications.set(portfolioId, application);
    }
    return application;
  }

  #grant(state: PortfolioAdmissionState, grantId: string) {
    const grant = state.grants[grantId];
    if (!grant) throw new Error(`Unknown Portfolio Capacity Grant ${grantId}`);
    return grant;
  }

  #assertGeneration(generation: number): void {
    if (generation !== this.#generation) throw new Error('Portfolio Capacity operation escaped its Root generation');
  }
}

export function createPortfolioValidatedBundleAuthority(
  input: WorkroomSchedulerCapacityRequest,
  validated: ValidatedAtomicResourceBundle,
): PortfolioValidatedBundleAuthority {
  if (validated.requestId !== input.capacityRequest.requestId
    || validated.projectId !== input.capacityRequest.projectId
    || validated.catalogRef.revision !== input.catalogRevision
    || validated.catalogRef.digest !== input.catalogDigest
    || validated.profileAuthorityRef.profileRevisionId !== input.capacityRequest.workRef.profileRevisionId
    || validated.profileAuthorityRef.profileDigest !== input.capacityRequest.workRef.profileDigest
    || canonicalWorkroomJson(validated.workRef) !== canonicalWorkroomJson(input.capacityRequest.workRef)) {
    throw new Error('Validated Atomic Resource Bundle escaped its exact request/Profile/Catalog authority');
  }
  const claims = {
    requestDigest: portfolioCapacityRequestDigest(input.capacityRequest),
    resourceBundleDigest: portfolioCapacityRequestResourceBundleDigest(input.capacityRequest),
    catalogGenerationId: validated.catalogRef.generationId,
    catalogRevision: validated.catalogRef.revision,
    catalogDigest: validated.catalogRef.digest,
    profileRevisionId: validated.profileAuthorityRef.profileRevisionId,
    profileDigest: validated.profileAuthorityRef.profileDigest,
    profileCeilingDigest: validated.profileAuthorityRef.resourceCeilingDigest,
    reservedCostMicros: validated.totalWorstCaseCostMicros,
  };
  return Object.freeze({ ...claims, validatedBundleDigest: portfolioValidatedBundleDigest(claims) });
}

function portfolioCapacityRequestResourceBundleDigest(request: PortfolioCapacityRequest): string {
  return digest(parsePortfolioResourceBundle(request.resourceBundle));
}
