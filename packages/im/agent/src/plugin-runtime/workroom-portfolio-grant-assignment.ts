import type { AssignmentExecutionEnvelope } from '../workroom/assignment-executor.js';
import type { WorkroomLocalAssignmentClaimRequest } from '../workroom/local-assignment-issuance.js';
import type { WorkroomRemoteAssignmentClaimRequest } from '../workroom/remote-assignment-issuance.js';
import type { WorkroomKernel } from '../workroom/workroom-kernel.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import type { WorkroomCatalog } from '../workroom/catalog.js';
import {
  parseWorkroomDispatchTaskDecision,
  type WorkroomDispatchTaskDecision,
} from '../workroom/workroom-scheduler.js';
import { replayPortfolioAdmission, portfolioCapacityRequestDigest } from '../portfolio/portfolio-admission.js';
import type {
  PortfolioGrantAssignmentFailureReason,
  PortfolioJournalRepository,
} from '../portfolio/portfolio-journal.js';
import type {
  PortfolioControlAck,
  PortfolioControlCompensation,
  PortfolioControlOutboxItem,
  PortfolioWorkroomRoute,
} from '../portfolio/capacity-control-outbox.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { GenerationOwnedPortfolioCapacityRuntime } from './workroom-portfolio-capacity.js';
import type {
  PortfolioWorkroomAckAuthorityPort,
  PortfolioWorkroomControlDeliveryPort,
  PortfolioWorkroomRouteAuthorityPort,
} from './workroom-portfolio-control-runtime.js';
import type { WorkroomSchedulerAssignmentRoutePort } from './workroom-scheduler-runtime.js';
import {
  workroomSchedulerPortfolioOpaqueHeadId,
  workroomSchedulerPortfolioPayloadDigest,
  workroomSchedulerPortfolioRequestId,
} from './workroom-scheduler-portfolio-contract.js';
export {
  workroomSchedulerPortfolioOpaqueHeadId,
  workroomSchedulerPortfolioPayloadDigest,
  workroomSchedulerPortfolioRequestId,
} from './workroom-scheduler-portfolio-contract.js';

export type PortfolioGrantAssignmentClaim =
  | Readonly<{ kind: 'local'; request: WorkroomLocalAssignmentClaimRequest }>
  | Readonly<{ kind: 'remote'; request: WorkroomRemoteAssignmentClaimRequest }>;

export interface PortfolioGrantAssignmentBinding {
  readonly version: 1;
  readonly portfolioId: string;
  readonly projectId: string;
  readonly grantId: string;
  readonly grantFence: number;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly validatedBundleDigest: string;
  readonly schedulerDecisionId: string;
  readonly schedulerDecisionDigest: string;
  readonly schedulerSequence: number;
  readonly opaqueHeadId: string;
  readonly route: PortfolioWorkroomRoute;
  readonly claim: PortfolioGrantAssignmentClaim;
  readonly issuerPreview: PortfolioGrantAssignmentIssuerPreview;
  readonly assignmentRef: string;
  readonly digest: string;
}

/** Kernel-owned deterministic preview. Portfolio code must never derive an Assignment id. */
export interface PortfolioGrantAssignmentIssuerPreview {
  readonly version: 1;
  readonly kind: 'local' | 'remote';
  readonly assignmentRef: string;
  readonly claimDigest: string;
  readonly taskRevision: number;
  readonly kernelSequence: number;
  readonly kernelStateDigest: string;
  readonly previewDigest: string;
}

export interface PortfolioGrantAssignmentBindingAuthorityPort {
  resolve(item: PortfolioControlOutboxItem): Promise<PortfolioGrantAssignmentBinding | undefined>;
}

export interface PortfolioGrantAssignmentIssuancePort {
  preview(claim: PortfolioGrantAssignmentClaim): Promise<PortfolioGrantAssignmentIssuerPreview | undefined>;
  issue(
    claim: PortfolioGrantAssignmentClaim,
    preview: PortfolioGrantAssignmentIssuerPreview,
  ): Promise<PortfolioGrantAssignmentIssueResult>;
  find(claim: PortfolioGrantAssignmentClaim): Promise<Readonly<{
    issuedAt: number;
    envelope: AssignmentExecutionEnvelope;
  }> | undefined>;
}

export type PortfolioGrantAssignmentIssueResult =
  | Readonly<{ kind: 'claimed'; issuedAt: number; envelope: AssignmentExecutionEnvelope }>
  | Readonly<{
      kind: 'rejected'; reason: PortfolioGrantAssignmentFailureReason;
      kernelSequence: number; kernelFactDigest: string; proofDigest: string;
    }>;

export class PortfolioGrantAssignmentBindingUnavailableError extends Error {
  constructor(readonly itemId: string) {
    super(`Portfolio Grant has no exact Scheduler/Assignment binding for ${itemId}`);
    this.name = 'PortfolioGrantAssignmentBindingUnavailableError';
  }
}

export interface PortfolioGrantAssignmentAuthorityOptions {
  readonly portfolioJournal: Pick<PortfolioJournalRepository, 'read'>;
  readonly workroomJournal: Pick<WorkroomJournal, 'read'>;
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly schedulerRoute: WorkroomSchedulerAssignmentRoutePort;
  readonly issuances: Pick<PortfolioGrantAssignmentIssuancePort, 'preview'>;
}

/**
 * Maps a content-free Portfolio Grant back to one durable Scheduler decision.
 * No Task title, model output, or metadata participates in the authority path.
 */
export class PortfolioGrantAssignmentAuthority
implements PortfolioGrantAssignmentBindingAuthorityPort {
  readonly routeAuthority: PortfolioWorkroomRouteAuthorityPort;

  constructor(readonly options: PortfolioGrantAssignmentAuthorityOptions) {
    this.routeAuthority = Object.freeze({
      resolve: (input: Parameters<PortfolioWorkroomRouteAuthorityPort['resolve']>[0]) =>
        this.#resolveRoute(input),
    });
  }

  async resolve(item: PortfolioControlOutboxItem): Promise<PortfolioGrantAssignmentBinding | undefined> {
    if (item.payload.kind !== 'grant_offer') return undefined;
    const resolved = await this.#resolveFacts({
      portfolioId: item.portfolioId, projectId: item.projectId,
      grantId: item.payload.grant.grantId, requestId: item.payload.grant.requestId,
      grantFence: item.payload.grant.fence,
    });
    if (!resolved || canonicalWorkroomJson(resolved.route) !== canonicalWorkroomJson(item.route)) {
      return undefined;
    }
    const claim: PortfolioGrantAssignmentClaim = resolved.assignmentRoute.kind === 'local'
      ? { kind: 'local', request: {
          operationId: resolved.decision.decisionId, projectId: resolved.decision.projectId,
          runId: resolved.decision.runId, taskKey: resolved.decision.taskKey,
          agentDefinitionId: resolved.assignmentRoute.agentDefinitionId,
        } }
      : { kind: 'remote', request: {
          operationId: resolved.decision.decisionId, projectId: resolved.decision.projectId,
          runId: resolved.decision.runId, taskKey: resolved.decision.taskKey,
          agentDefinitionId: resolved.assignmentRoute.agentDefinitionId,
          endpointId: resolved.assignmentRoute.endpointId,
        } };
    const issuerPreview = await this.options.issuances.preview(claim);
    if (!issuerPreview || issuerPreview.taskRevision !== resolved.decision.taskRevision) return undefined;
    return portfolioGrantAssignmentBinding({
      portfolioId: item.portfolioId, projectId: item.projectId,
      grantId: resolved.grant.grantId, grantFence: resolved.grant.fence,
      requestId: resolved.request.requestId, requestDigest: resolved.grant.requestDigest,
      validatedBundleDigest: resolved.grant.validatedBundleDigest,
      schedulerDecisionId: resolved.decision.decisionId,
      schedulerDecisionDigest: resolved.decision.digest,
      schedulerSequence: resolved.request.schedulerSequence,
      opaqueHeadId: resolved.request.opaqueHeadId,
      route: resolved.route, claim, issuerPreview,
    });
  }

  async #resolveRoute(input: Parameters<PortfolioWorkroomRouteAuthorityPort['resolve']>[0]) {
    return (await this.#resolveFacts(input))?.route;
  }

  async #resolveFacts(input: Parameters<PortfolioWorkroomRouteAuthorityPort['resolve']>[0]) {
    const portfolioFacts = await this.options.portfolioJournal.read(input.portfolioId);
    const state = replayPortfolioAdmission(input.portfolioId, portfolioFacts);
    const grant = state.grants[input.grantId];
    const requestState = state.requests[input.requestId];
    if (!grant || !requestState || grant.projectId !== input.projectId
      || grant.requestId !== input.requestId || grant.fence !== input.grantFence
      || grant.requestDigest !== portfolioCapacityRequestDigest(requestState.request)) return undefined;
    const request = requestState.request;
    const events = await this.options.workroomJournal.read(request.workRef.runId);
    const dispatchEvent = events[request.schedulerSequence];
    if (!dispatchEvent || dispatchEvent.type !== 'scheduler.dispatch_requested') return undefined;
    const decision = parseWorkroomDispatchTaskDecision(dispatchEvent.payload);
    if (decision.projectId !== request.projectId || decision.runId !== request.workRef.runId
      || decision.policy.digest !== request.schedulerRevision
      || request.opaqueHeadId !== workroomSchedulerPortfolioOpaqueHeadId(decision)) return undefined;
    const catalog = await this.options.catalog.read();
    const assignmentRoute = await this.options.schedulerRoute.resolve({ decision, catalog });
    if (!assignmentRoute) return undefined;
    if (request.requestId !== workroomSchedulerPortfolioRequestId(decision, assignmentRoute)
      || request.payloadDigest !== workroomSchedulerPortfolioPayloadDigest(decision, assignmentRoute)) {
      return undefined;
    }
    const definition = catalog.definitions[decision.projectId];
    if (!definition || definition.enabled === false || !definition.members.some(member =>
      member.role === decision.role && member.agent === assignmentRoute.agentDefinitionId)) return undefined;
    const routeAuthority = deepFreeze({
      catalogRevision: catalog.revision,
      schedulerAuthorityRef: assignmentRoute.authorityRef,
      projectId: decision.projectId,
      agentDefinitionId: assignmentRoute.agentDefinitionId,
      ...(assignmentRoute.kind === 'remote' ? { endpointId: assignmentRoute.endpointId } : {}),
    });
    const route = deepFreeze({
      projectId: decision.projectId,
      routeRef: `portfolio-assignment-route:${decision.decisionId}`,
      routeDigest: digest({ decisionDigest: decision.digest, routeAuthority }),
      authorityRef: assignmentRoute.authorityRef,
      authorityDigest: digest(routeAuthority),
    });
    return deepFreeze({ grant, request, decision, assignmentRoute, route });
  }
}

/** Kernel-owned preview/claim adapter with restart-safe lost-response recovery. */
export class KernelPortfolioGrantAssignmentIssuance implements PortfolioGrantAssignmentIssuancePort {
  constructor(readonly kernel: Pick<WorkroomKernel,
    | 'previewLocalAssignment' | 'previewRemoteAssignment'
    | 'issueLocalAssignment' | 'issueRemoteAssignment'
    | 'findLocalAssignment' | 'findRemoteAssignment' | 'read'>) {}

  async preview(claim: PortfolioGrantAssignmentClaim): Promise<PortfolioGrantAssignmentIssuerPreview> {
    return claim.kind === 'local'
      ? await this.kernel.previewLocalAssignment(claim.request)
      : await this.kernel.previewRemoteAssignment(claim.request);
  }

  async issue(
    claim: PortfolioGrantAssignmentClaim,
    preview: PortfolioGrantAssignmentIssuerPreview,
  ): Promise<PortfolioGrantAssignmentIssueResult> {
    const currentPreview = await this.preview(claim);
    if (canonicalWorkroomJson(currentPreview) !== canonicalWorkroomJson(preview)) {
      throw new Error('Kernel Assignment issuer preview changed before claim');
    }
    try {
      const issued = claim.kind === 'local'
        ? await this.kernel.issueLocalAssignment(claim.request)
        : await this.kernel.issueRemoteAssignment(claim.request);
      return deepFreeze({ kind: 'claimed' as const, issuedAt: issued.issuedAt, envelope: issued.envelope });
    } catch (error) {
      const recovered = await this.find(claim);
      if (recovered) return deepFreeze({ kind: 'claimed' as const, ...recovered });
      const state = await this.kernel.read(claim.request.projectId, claim.request.runId);
      const task = state.tasks[claim.request.taskKey];
      const reason = deterministicFailureReason(state.status, task?.status, task?.revision, preview.taskRevision);
      if (!reason) throw error;
      const kernelFactDigest = digest(state);
      const proofBody = deepFreeze({
        version: 1 as const, reason, assignmentRef: preview.assignmentRef,
        claimDigest: preview.claimDigest, kernelSequence: state.sequence, kernelFactDigest,
      });
      return deepFreeze({
        kind: 'rejected' as const, reason, kernelSequence: state.sequence,
        kernelFactDigest, proofDigest: digest(proofBody),
      });
    }
  }

  async find(claim: PortfolioGrantAssignmentClaim): Promise<Readonly<{
    issuedAt: number; envelope: AssignmentExecutionEnvelope;
  }> | undefined> {
    const issued = claim.kind === 'local'
      ? await this.kernel.findLocalAssignment(claim.request)
      : await this.kernel.findRemoteAssignment(claim.request);
    return issued ? deepFreeze({ issuedAt: issued.issuedAt, envelope: issued.envelope }) : undefined;
  }
}

export class PortfolioGrantAssignmentCompensatedError extends Error {
  constructor(readonly compensation: PortfolioControlCompensation) {
    super(`Portfolio Grant Assignment was deterministically rejected for ${compensation.itemId}`);
    this.name = 'PortfolioGrantAssignmentCompensatedError';
  }
}

/**
 * Consume-first recovery saga. The deterministic Assignment ref is reserved in
 * the Portfolio Journal before Kernel issuance, so an Executor can never see
 * an Assignment without an already-consumed Grant.
 */
export class WorkroomPortfolioGrantAssignmentSaga
implements PortfolioWorkroomControlDeliveryPort, PortfolioWorkroomAckAuthorityPort {
  constructor(readonly options: Readonly<{
    generation: number;
    capacity: Pick<GenerationOwnedPortfolioCapacityRuntime, 'consume' | 'failAssignment'>;
    bindings: PortfolioGrantAssignmentBindingAuthorityPort;
    issuances: PortfolioGrantAssignmentIssuancePort;
  }>) {}

  deliver(item: PortfolioControlOutboxItem, signal: AbortSignal): Promise<PortfolioControlAck> {
    return this.#deliver(item, signal);
  }

  reconcile(item: PortfolioControlOutboxItem, signal: AbortSignal): Promise<PortfolioControlAck> {
    return this.#deliver(item, signal);
  }

  async authenticate(item: PortfolioControlOutboxItem, ack: PortfolioControlAck): Promise<boolean> {
    if (item.payload.kind !== 'grant_offer' || ack.kind !== 'grant_accepted') return false;
    const binding = await this.options.bindings.resolve(item);
    if (!binding || canonicalWorkroomJson(binding.route) !== canonicalWorkroomJson(item.route)) return false;
    const issued = await this.options.issuances.find(binding.claim);
    if (!issued) return false;
    return canonicalWorkroomJson(createAck(item, binding, issued)) === canonicalWorkroomJson(ack);
  }

  async #deliver(item: PortfolioControlOutboxItem, signal: AbortSignal): Promise<PortfolioControlAck> {
    signal.throwIfAborted();
    if (item.payload.kind !== 'grant_offer') {
      throw new PortfolioGrantAssignmentBindingUnavailableError(item.itemId);
    }
    const binding = await this.options.bindings.resolve(item);
    if (!binding || canonicalWorkroomJson(binding.route) !== canonicalWorkroomJson(item.route)) {
      throw new PortfolioGrantAssignmentBindingUnavailableError(item.itemId);
    }
    assertBinding(item, binding);
    await this.options.capacity.consume({
      generation: this.options.generation,
      portfolioId: item.portfolioId,
      grantId: item.payload.grant.grantId,
      projectId: item.projectId,
      fence: item.payload.grant.fence,
      assignmentRef: binding.assignmentRef,
    });
    signal.throwIfAborted();
    const preview = await this.options.issuances.preview(binding.claim);
    if (!preview || canonicalWorkroomJson(preview) !== canonicalWorkroomJson(binding.issuerPreview)) {
      throw new PortfolioGrantAssignmentBindingUnavailableError(item.itemId);
    }
    const issued = await this.options.issuances.issue(binding.claim, preview);
    if (issued.kind === 'rejected') {
      await this.options.capacity.failAssignment({
        generation: this.options.generation,
        portfolioId: item.portfolioId,
        grantId: item.payload.grant.grantId,
        projectId: item.projectId,
        fence: item.payload.grant.fence,
        assignmentRef: binding.assignmentRef,
        reason: issued.reason,
        kernelSequence: issued.kernelSequence,
        kernelFactDigest: issued.kernelFactDigest,
      });
      throw new PortfolioGrantAssignmentCompensatedError(createCompensation(item, binding, issued));
    }
    if (issued.envelope.assignmentId !== binding.assignmentRef
      || issued.envelope.projectId !== item.projectId
      || issued.envelope.runId !== binding.claim.request.runId
      || issued.envelope.taskKey !== binding.claim.request.taskKey) {
      throw new Error('Kernel Assignment issuance drifted from the consumed Portfolio Grant');
    }
    return createAck(item, binding, issued);
  }
}

export function portfolioGrantAssignmentBinding(
  input: Omit<PortfolioGrantAssignmentBinding, 'version' | 'assignmentRef' | 'digest'>,
): PortfolioGrantAssignmentBinding {
  const claimDigest = digest(input.claim);
  const { previewDigest, ...previewBody } = input.issuerPreview;
  if (input.issuerPreview.version !== 1 || input.issuerPreview.kind !== input.claim.kind
    || input.issuerPreview.claimDigest !== claimDigest
    || input.issuerPreview.previewDigest !== digest(previewBody)) {
    throw new Error('Kernel Assignment issuer preview is stale');
  }
  const assignmentRef = input.issuerPreview.assignmentRef;
  const body = deepFreeze({ version: 1 as const, ...structuredClone(input), assignmentRef });
  return deepFreeze({ ...body, digest: digest(body) });
}

export function portfolioGrantAssignmentIssuerPreview(input: Readonly<{
  kind: 'local' | 'remote'; assignmentRef: string; claimDigest: string;
  taskRevision: number; kernelSequence: number; kernelStateDigest: string;
}>): PortfolioGrantAssignmentIssuerPreview {
  const body = deepFreeze({ version: 1 as const, ...structuredClone(input) });
  return deepFreeze({ ...body, previewDigest: digest(body) });
}

function assertBinding(item: PortfolioControlOutboxItem, binding: PortfolioGrantAssignmentBinding): void {
  const { version: ignoredVersion, assignmentRef: ignoredAssignmentRef, digest: ignoredDigest, ...input } = binding;
  void ignoredVersion;
  void ignoredAssignmentRef;
  void ignoredDigest;
  const canonical = portfolioGrantAssignmentBinding(input);
  if (canonicalWorkroomJson(canonical) !== canonicalWorkroomJson(binding)
    || binding.portfolioId !== item.portfolioId || binding.projectId !== item.projectId
    || binding.grantId !== item.payload.grant.grantId
    || binding.grantFence !== item.payload.grant.fence
    || binding.requestId !== item.payload.grant.requestId
    || binding.requestDigest !== item.payload.grant.requestDigest) {
    throw new Error('Portfolio Grant Assignment binding is stale');
  }
}

function createAck(
  item: PortfolioControlOutboxItem,
  binding: PortfolioGrantAssignmentBinding,
  issued: Readonly<{ issuedAt: number; envelope: AssignmentExecutionEnvelope }>,
): Extract<PortfolioControlAck, { kind: 'grant_accepted' }> {
  const body = deepFreeze({
    version: 1 as const,
    kind: 'grant_accepted' as const,
    ackId: `portfolio-grant-assignment:${binding.digest.slice('sha256:'.length)}`,
    portfolioId: item.portfolioId,
    projectId: item.projectId,
    itemId: item.itemId,
    grantId: item.payload.grant.grantId,
    requestId: item.payload.grant.requestId,
    grantFence: item.payload.grant.fence,
    deliveryFence: item.deliveryFence,
    assignmentRef: issued.envelope.assignmentId,
    assignmentAttempt: issued.envelope.attempt,
    assignmentFence: issued.envelope.fence,
    producer: {
      principalId: issued.envelope.principalId,
      authorityRef: `assignment-envelope:${issued.envelope.assignmentId}:${issued.envelope.fence}`,
      authorityDigest: issued.envelope.digest,
    },
    observedAt: issued.issuedAt,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function createCompensation(
  item: PortfolioControlOutboxItem,
  binding: PortfolioGrantAssignmentBinding,
  rejected: Extract<PortfolioGrantAssignmentIssueResult, { kind: 'rejected' }>,
): PortfolioControlCompensation {
  const body = deepFreeze({
    version: 1 as const,
    itemId: item.itemId,
    portfolioId: item.portfolioId,
    projectId: item.projectId,
    grantId: item.payload.grant.grantId,
    grantFence: item.payload.grant.fence,
    deliveryFence: item.deliveryFence,
    assignmentRef: binding.assignmentRef,
    reason: rejected.reason,
    kernelSequence: rejected.kernelSequence,
    kernelFactDigest: rejected.kernelFactDigest,
    proofDigest: rejected.proofDigest,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function deterministicFailureReason(
  runStatus: string,
  taskStatus: string | undefined,
  taskRevision: number | undefined,
  previewTaskRevision: number,
): PortfolioGrantAssignmentFailureReason | undefined {
  if (runStatus === 'completed' || runStatus === 'cancelled') return 'run_terminal';
  if (taskStatus === 'accepted' || taskStatus === 'failed' || taskStatus === 'cancelled') {
    return 'task_terminal';
  }
  if (taskRevision !== undefined && taskRevision !== previewTaskRevision) return 'task_stale';
  if (taskStatus === 'executing' || taskStatus === 'awaiting_acceptance' || taskStatus === 'cancelling') {
    return 'task_stale';
  }
  return undefined;
}
