import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomCatalogSnapshot } from '../workroom/catalog.js';
import type { WorkroomJournal } from '../workroom/journal.js';
import type { ProjectProfileRegistry } from '../workroom/profile-registry.js';
import {
  canonicalWorkroomJson,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import {
  parsePortfolioCapacityRequest,
  parsePortfolioPolicySnapshot,
  parsePortfolioResourceBundle,
  type PortfolioResourceBundle,
  type PortfolioPolicySnapshot,
} from '../portfolio/portfolio-journal.js';
import type { ValidatedAtomicResourceBundle } from '../portfolio/resource-bundle.js';
import {
  getWorkroomScheduledTaskCapacitySnapshot,
  parseWorkroomDispatchTaskDecision,
  type WorkroomDispatchTaskDecision,
} from '../workroom/workroom-scheduler.js';
import { assertWorkflowPlanProposal, type WorkflowPlanProposal } from '../workroom/workflow-plan-builder.js';
import type {
  PortfolioAtomicBundleAuthorityPort,
  PortfolioPolicyAuthorityPort,
  WorkroomSchedulerCapacityRequest,
} from './workroom-portfolio-capacity.js';
import {
  workroomSchedulerPortfolioOpaqueHeadId,
  workroomSchedulerPortfolioPayloadDigest,
  workroomSchedulerPortfolioRequestId,
} from './workroom-scheduler-portfolio-contract.js';
import type { WorkroomSchedulerAssignmentRoute } from './workroom-scheduler-runtime.js';
import type { WorkroomSchedulerPortfolioRequestAuthorityPort } from './workroom-scheduler-portfolio-supply.js';

export interface WorkroomSchedulerPortfolioScopeAuthority {
  readonly version: 1;
  readonly generation: number;
  readonly projectId: string;
  readonly workroomCatalogRevision: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly portfolioId: string;
  readonly tenantId: string;
  readonly portfolioPolicyRevision: number;
  readonly portfolioPolicyDigest: string;
  /** Stable Portfolio clock fact pinned by the scope publisher, not current wall time. */
  readonly portfolioClockAnchor: number;
  readonly portfolioClockDigest: string;
  readonly resourceCatalogGenerationId: string;
  readonly resourceCatalogRevision: number;
  readonly resourceCatalogDigest: string;
  readonly bindingDigest: string;
}

export type WorkroomSchedulerPortfolioScopeAuthorityBody = Omit<
  WorkroomSchedulerPortfolioScopeAuthority,
  'bindingDigest'
>;

export interface WorkroomSchedulerPortfolioScopeAuthorityPort {
  resolve(input: Readonly<{
    generation: number;
    projectId: string;
    workroomCatalogRevision: string;
    profileRevisionId: string;
    profileDigest: string;
  }>): Promise<WorkroomSchedulerPortfolioScopeAuthority | undefined>;
}

export const workroomSchedulerPortfolioScopeAuthorityToken =
  createToken<WorkroomSchedulerPortfolioScopeAuthorityPort>(
    'zhin.agent.workroom-scheduler-portfolio-scope-authority',
    'Trusted Project/Profile to Portfolio tenant and Resource Catalog scope authority',
  );

export interface PinnedProfileWorkroomSchedulerPortfolioRequestAuthorityOptions {
  readonly generation: number;
  readonly journal: Pick<WorkroomJournal, 'read'>;
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
  readonly scopes: WorkroomSchedulerPortfolioScopeAuthorityPort;
  readonly policies: PortfolioPolicyAuthorityPort;
  readonly bundles: PortfolioAtomicBundleAuthorityPort;
  /** Explicit generation-owned fallback for legacy Profiles without a resource declaration. */
  readonly fallbackResourceRequirements?: PortfolioResourceBundle;
}

/**
 * Projects one Scheduler dispatch into a content-free Portfolio request. Every
 * quantity comes from the Run-pinned compiled Profile; every Portfolio/Catalog
 * identity is echoed by trusted generation-owned authorities.
 */
export class PinnedProfileWorkroomSchedulerPortfolioRequestAuthority
implements WorkroomSchedulerPortfolioRequestAuthorityPort {
  readonly #generation: number;

  constructor(readonly options: PinnedProfileWorkroomSchedulerPortfolioRequestAuthorityOptions) {
    this.#generation = nonNegativeInteger(options.generation, 'generation');
  }

  async resolve(input: Readonly<{
    generation: number;
    decision: WorkroomDispatchTaskDecision;
    route: WorkroomSchedulerAssignmentRoute;
    catalog: WorkroomCatalogSnapshot;
  }>): Promise<WorkroomSchedulerCapacityRequest | undefined> {
    if (input.generation !== this.#generation) return undefined;
    const decision = parseWorkroomDispatchTaskDecision(input.decision);
    const definition = input.catalog.definitions[decision.projectId];
    if (!definition || definition.enabled === false) return undefined;
    const exactMembers = definition.members.filter(member =>
      member.role === decision.role && member.agent === input.route.agentDefinitionId);
    if (exactMembers.length !== 1) return undefined;

    const events = await this.options.journal.read(decision.runId);
    const dispatch = events[decision.expectedSequence + 1];
    if (!dispatch || dispatch.sequence !== decision.expectedSequence + 1
      || dispatch.type !== 'scheduler.dispatch_requested') return undefined;
    const persistedDecision = parseWorkroomDispatchTaskDecision(dispatch.payload);
    if (persistedDecision.digest !== decision.digest) return undefined;
    const task = getWorkroomScheduledTaskCapacitySnapshot(events, decision.taskKey);
    if (task.taskRevision !== decision.taskRevision || task.role !== decision.role) return undefined;

    const admitted = events.filter(event => event.type === 'plan.admitted');
    if (admitted.length !== 1) return undefined;
    const plan = admitted[0]!.payload.plan;
    if (!plan || typeof plan !== 'object') return undefined;
    assertWorkflowPlanProposal(plan as WorkflowPlanProposal);
    const admittedPlan = plan as WorkflowPlanProposal;
    if (admittedPlan.projectId !== decision.projectId
      || !admittedPlan.tasks.some(candidate => candidate.key === decision.taskKey
        && candidate.role === decision.role)) return undefined;

    const registry = await this.options.profiles.read(decision.projectId);
    const pin = registry.runPins[decision.runId];
    const revision = pin && registry.revisions[pin.profileRevisionId];
    if (!pin || !revision || pin.projectId !== decision.projectId || pin.runId !== decision.runId
      || revision.projectId !== decision.projectId
      || revision.revisionId !== pin.profileRevisionId
      || revision.compiledDigest !== pin.profileDigest
      || revision.compiledProfile.revisionId !== pin.profileRevisionId
      || revision.compiledProfile.projectId !== decision.projectId
      || revision.compiledProfile.digest !== pin.profileDigest) return undefined;
    const workflows = revision.compiledProfile.workflows.filter(workflow =>
      workflow.id === admittedPlan.strategy.id && workflow.digest === admittedPlan.strategy.digest);
    if (workflows.length !== 1 || admittedPlan.strategy.version !== pin.profileRevisionId) return undefined;
    const templates = workflows[0]!.tasks.filter(candidate => candidate.role === decision.role);
    if (templates.length !== 1) return undefined;
    const requirements = templates[0]!.resourceRequirements
      ?? this.options.fallbackResourceRequirements;
    if (!requirements) return undefined;
    const resourceBundle = parsePortfolioResourceBundle(requirements);

    const scopeInput = Object.freeze({
      generation: this.#generation,
      projectId: decision.projectId,
      workroomCatalogRevision: input.catalog.revision,
      profileRevisionId: pin.profileRevisionId,
      profileDigest: pin.profileDigest,
    });
    const scopeCandidate = await this.options.scopes.resolve(scopeInput);
    if (!scopeCandidate) return undefined;
    const scope = parseScopeAuthority(scopeCandidate);
    if (scope.generation !== scopeInput.generation || scope.projectId !== scopeInput.projectId
      || scope.workroomCatalogRevision !== scopeInput.workroomCatalogRevision
      || scope.profileRevisionId !== scopeInput.profileRevisionId
      || scope.profileDigest !== scopeInput.profileDigest) {
      throw new Error('Portfolio scope authority did not exactly echo the Scheduler/Profile input');
    }

    const policyAuthority = await this.options.policies.resolve(scope.portfolioId);
    if (!policyAuthority) return undefined;
    const policy = parsePortfolioPolicySnapshot(policyAuthority.policy);
    if (policy.revision !== scope.portfolioPolicyRevision
      || policy.digest !== scope.portfolioPolicyDigest) return undefined;
    const projectPolicy = policy.projects[decision.projectId];
    if (!projectPolicy || resourceBundle.demands.some(demand =>
      !projectPolicy.allowedPools.includes(demand.poolId))) return undefined;
    const starvationAt = checkedSum(
      checkedSum(scope.portfolioClockAnchor, decision.expectedSequence + 1, 'Portfolio local order'),
      projectPolicy.starvationTicks,
      'starvationAt',
    );

    const capacityRequest = parsePortfolioCapacityRequest({
      requestId: workroomSchedulerPortfolioRequestId(decision, input.route),
      projectId: decision.projectId,
      workRef: {
        runId: decision.runId,
        profileRevisionId: pin.profileRevisionId,
        profileDigest: pin.profileDigest,
      },
      schedulerRevision: decision.policy.digest,
      schedulerSequence: decision.expectedSequence + 1,
      localOrder: decision.expectedSequence + 1,
      projectPolicyRevision: projectPolicy.revision,
      opaqueHeadId: workroomSchedulerPortfolioOpaqueHeadId(decision),
      payloadDigest: workroomSchedulerPortfolioPayloadDigest(decision, input.route),
      resourceBundle,
      preemptibility: task.preemptibility,
      starvationAt,
    });
    const request = Object.freeze({
      generation: this.#generation,
      portfolioId: scope.portfolioId,
      tenantId: scope.tenantId,
      catalogRevision: scope.resourceCatalogRevision,
      catalogDigest: scope.resourceCatalogDigest,
      capacityRequest,
    });
    const validated = await this.options.bundles.validate(request);
    if (!validated) return undefined;
    assertValidatedBundleEcho(validated, request, scope, policy);
    return request;
  }
}

export function workroomSchedulerPortfolioScopeBindingDigest(
  source: WorkroomSchedulerPortfolioScopeAuthorityBody,
): string {
  return digest(parseScopeBody(source));
}

function parseScopeAuthority(value: WorkroomSchedulerPortfolioScopeAuthority) {
  exactKeys(value, [
    'version', 'generation', 'projectId', 'workroomCatalogRevision', 'profileRevisionId',
    'profileDigest', 'portfolioId', 'tenantId', 'portfolioPolicyRevision',
    'portfolioPolicyDigest', 'portfolioClockAnchor', 'portfolioClockDigest', 'resourceCatalogGenerationId',
    'resourceCatalogRevision', 'resourceCatalogDigest', 'bindingDigest',
  ], 'Portfolio scope authority');
  const { bindingDigest, ...source } = value;
  const body = parseScopeBody(source);
  const exactDigest = canonicalDigest(bindingDigest, 'Portfolio scope bindingDigest');
  if (exactDigest !== digest(body)) throw new Error('Portfolio scope authority binding digest drift');
  return Object.freeze({ ...body, bindingDigest: exactDigest });
}

function parseScopeBody(value: WorkroomSchedulerPortfolioScopeAuthorityBody) {
  exactKeys(value, [
    'version', 'generation', 'projectId', 'workroomCatalogRevision', 'profileRevisionId',
    'profileDigest', 'portfolioId', 'tenantId', 'portfolioPolicyRevision',
    'portfolioPolicyDigest', 'portfolioClockAnchor', 'portfolioClockDigest', 'resourceCatalogGenerationId',
    'resourceCatalogRevision', 'resourceCatalogDigest',
  ], 'Portfolio scope authority body');
  if (value.version !== 1) throw new Error('Portfolio scope authority version is invalid');
  return Object.freeze({
    version: 1 as const,
    generation: nonNegativeInteger(value.generation, 'scope generation'),
    projectId: text(value.projectId, 'scope projectId'),
    workroomCatalogRevision: text(value.workroomCatalogRevision, 'scope Workroom Catalog revision'),
    profileRevisionId: text(value.profileRevisionId, 'scope Profile revision'),
    profileDigest: canonicalDigest(value.profileDigest, 'scope Profile digest'),
    portfolioId: text(value.portfolioId, 'scope portfolioId'),
    tenantId: text(value.tenantId, 'scope tenantId'),
    portfolioPolicyRevision: positiveInteger(value.portfolioPolicyRevision, 'scope Portfolio Policy revision'),
    portfolioPolicyDigest: canonicalDigest(value.portfolioPolicyDigest, 'scope Portfolio Policy digest'),
    portfolioClockAnchor: nonNegativeInteger(value.portfolioClockAnchor, 'scope Portfolio clock anchor'),
    portfolioClockDigest: canonicalDigest(value.portfolioClockDigest, 'scope Portfolio clock digest'),
    resourceCatalogGenerationId: text(value.resourceCatalogGenerationId, 'scope Resource Catalog generation'),
    resourceCatalogRevision: positiveInteger(value.resourceCatalogRevision, 'scope Resource Catalog revision'),
    resourceCatalogDigest: canonicalDigest(value.resourceCatalogDigest, 'scope Resource Catalog digest'),
  });
}

function assertValidatedBundleEcho(
  validated: ValidatedAtomicResourceBundle,
  request: WorkroomSchedulerCapacityRequest,
  scope: WorkroomSchedulerPortfolioScopeAuthority,
  policy: PortfolioPolicySnapshot,
): void {
  const expectedBundle = request.capacityRequest.resourceBundle;
  const echoedBundle = parsePortfolioResourceBundle({ demands: [
    {
      poolId: validated.model.poolId,
      capacityUnits: validated.model.capacityUnits,
      rateUnits: validated.model.rateUnits,
      budgetUnits: validated.model.worstCaseUsageUnits,
    },
    {
      poolId: validated.executor.poolId,
      capacityUnits: validated.executor.capacityUnits,
      rateUnits: validated.executor.rateUnits,
      budgetUnits: validated.executor.worstCaseUsageUnits,
    },
  ] });
  const projectPolicy = policy.projects[request.capacityRequest.projectId];
  if (validated.requestId !== request.capacityRequest.requestId
    || validated.projectId !== request.capacityRequest.projectId
    || canonicalWorkroomJson(validated.workRef) !== canonicalWorkroomJson(request.capacityRequest.workRef)
    || validated.catalogRef.generationId !== scope.resourceCatalogGenerationId
    || validated.catalogRef.revision !== request.catalogRevision
    || validated.catalogRef.digest !== request.catalogDigest
    || validated.profileAuthorityRef.tenantId !== request.tenantId
    || validated.profileAuthorityRef.projectId !== request.capacityRequest.projectId
    || validated.profileAuthorityRef.profileRevisionId !== request.capacityRequest.workRef.profileRevisionId
    || validated.profileAuthorityRef.profileDigest !== request.capacityRequest.workRef.profileDigest
    || canonicalWorkroomJson(echoedBundle) !== canonicalWorkroomJson(expectedBundle)
    || !projectPolicy
    || validated.totalWorstCaseCostMicros > projectPolicy.hardBudgetMicros) {
    throw new Error('Validated Atomic Resource Bundle did not exactly echo request/Profile/Catalog authority');
  }
}

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${label} exact keys are invalid`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function canonicalDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed === 0) throw new Error(`${label} is invalid`);
  return parsed;
}

function checkedSum(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} is invalid`);
  return result;
}
