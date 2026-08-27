import { createHash } from 'node:crypto';
import type { Scope } from '@zhin.js/plugin-runtime';
import {
  assertWorkflowPlanProposal,
  assignmentAuthorityGrantKey,
  createAssignmentAuthorityGrantRecord,
  createAtomicResourceBundleProfileCeiling,
  createPortfolioPolicySnapshot,
  createResourcePoolCatalogSnapshot,
  parseWorkroomDispatchTaskDecision,
  portfolioKernelCommandDigest,
  replayPortfolioAdmission,
  validateAtomicResourceBundle,
  workroomLocalAssignmentId,
  type AssignmentAuthorityGrantRepository,
  type PortfolioJournalRepository,
  type PortfolioResourceBundle,
  type ProjectProfileRegistry,
  type WorkroomCatalog,
  type WorkroomJournal,
  type WorkroomKernel,
  type WorkflowPlanProposal,
} from '@zhin.js/agent';
import {
  createWorkroomAssignmentAuthorityGrant,
  digestCanonicalWorkroomValue,
  digestWorkroomCatalogProjectBinding,
  portfolioAtomicBundleAuthorityToken,
  portfolioKernelCommandAuthorityToken,
  portfolioPolicyAuthorityToken,
  workroomSchedulerPortfolioScopeAuthorityToken,
  workroomSchedulerPortfolioScopeBindingDigest,
  type WorkroomAssignmentAuthorityGrantPort,
  type PortfolioAtomicBundleAuthorityPort,
  type PortfolioKernelCommandAuthorityPort,
  type PortfolioPolicyAuthorityPort,
  type WorkroomSchedulerPortfolioScopeAuthorityPort,
} from '@zhin.js/agent/runtime';

export const LOCAL_WORKROOM_MODEL_POOL_ID = 'model:local';
export const LOCAL_WORKROOM_EXECUTOR_POOL_ID = 'executor:local';
export const LOCAL_WORKROOM_RESOURCE_REQUIREMENTS: PortfolioResourceBundle = Object.freeze({
  demands: Object.freeze([
    Object.freeze({
      poolId: LOCAL_WORKROOM_MODEL_POOL_ID,
      capacityUnits: 1,
      rateUnits: 1,
      budgetUnits: 1,
    }),
    Object.freeze({
      poolId: LOCAL_WORKROOM_EXECUTOR_POOL_ID,
      capacityUnits: 1,
      rateUnits: 1,
      budgetUnits: 0,
    }),
  ]),
});

const LOCAL_ASSIGNMENT_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

interface LocalAssignmentGrantOptions {
  readonly generation: number;
  readonly projectRoot: string;
  readonly repository: AssignmentAuthorityGrantRepository;
  readonly durable: WorkroomAssignmentAuthorityGrantPort;
  readonly journal: Pick<WorkroomJournal, 'read'>;
  readonly catalog: Pick<WorkroomCatalog, 'read'>;
  readonly profiles: Pick<ProjectProfileRegistry, 'read'>;
  readonly runState: Pick<WorkroomKernel, 'read'>;
}

type LocalAssignmentGrantRequest = Parameters<WorkroomAssignmentAuthorityGrantPort['resolve']>[0];

/**
 * Materializes the Root-local Assignment grant from exact durable Workroom
 * facts, persists it with CAS, then delegates every read to the ordinary
 * durable grant provider. Remote grants are never synthesized here.
 */
export function createLocalWorkroomAssignmentGrantProvider(
  options: Readonly<LocalAssignmentGrantOptions>,
): WorkroomAssignmentAuthorityGrantPort {
  return Object.freeze({
    resolve: async (request: LocalAssignmentGrantRequest) => {
      const persisted = await options.durable.resolve(request);
      if (persisted || request.requestedEndpointId !== undefined) return persisted;
      const prepared = await prepareLocalAssignmentGrant(options, request);
      return await options.durable.resolve(request) ?? prepared;
    },
  });
}

async function prepareLocalAssignmentGrant(
  options: Readonly<LocalAssignmentGrantOptions>,
  request: LocalAssignmentGrantRequest,
) {
  const [events, state, registry, catalog] = await Promise.all([
    options.journal.read(request.runId),
    options.runState.read(request.projectId, request.runId),
    options.profiles.read(request.projectId),
    options.catalog.read(),
  ]);
  if (state.projectId !== request.projectId || state.runId !== request.runId) {
    throw new Error('Local Assignment Grant Project/Run scope drift');
  }
  const task = state.tasks[request.taskKey];
  if (!task || task.status !== 'ready' || !task.acceptanceContract
    || task.revision !== request.taskRevision || task.attempt + 1 !== request.attempt) {
    throw new Error('Local Assignment Grant targets a stale or unpinned Task');
  }
  const expectedFence = Object.values(state.assignments)
    .filter(assignment => assignment.taskKey === task.key)
    .reduce((highest, assignment) => Math.max(highest, assignment.fence), 0) + 1;
  if (expectedFence !== request.fence || request.assignmentRevision !== 1) {
    throw new Error('Local Assignment Grant attempt or fence drift');
  }
  const schedulerFacts = events.filter(event => event.type === 'scheduler.dispatch_requested'
    && workroomLocalAssignmentId(String(event.payload.decisionId ?? '')) === request.assignmentId);
  if (schedulerFacts.length !== 1) {
    throw new Error('Local Assignment Grant requires one exact Scheduler decision fact');
  }
  const schedulerFact = schedulerFacts[0]!;
  const decision = parseWorkroomDispatchTaskDecision(schedulerFact.payload);
  if (decision.projectId !== request.projectId || decision.runId !== request.runId
    || decision.taskKey !== request.taskKey || decision.taskRevision !== request.taskRevision
    || workroomLocalAssignmentId(decision.decisionId) !== request.assignmentId
    || (decision.role !== 'executor' && decision.role !== 'integration')) {
    throw new Error('Local Assignment Grant Scheduler decision scope drift');
  }
  const pin = registry.runPins[request.runId];
  const revision = pin && registry.revisions[pin.profileRevisionId];
  if (!pin || !revision || pin.projectId !== request.projectId
    || revision.compiledDigest !== pin.profileDigest
    || revision.compiledProfile.projectId !== request.projectId
    || revision.compiledProfile.revisionId !== pin.profileRevisionId
    || revision.compiledProfile.digest !== pin.profileDigest) {
    throw new Error('Local Assignment Grant requires an exact persisted Run Profile pin');
  }
  const definition = catalog.definitions[request.projectId];
  const member = definition?.members.find(candidate =>
    candidate.agent === request.requestedAgentDefinitionId && candidate.role === decision.role);
  if (!definition || definition.enabled === false || !member
    || member.assignmentRoute?.kind === 'remote') {
    throw new Error('Local Assignment Grant route is outside the exact Catalog role binding');
  }
  const profileAgent = revision.compiledProfile.agents.find(candidate =>
    candidate.id === request.requestedAgentDefinitionId && candidate.role === member.role);
  if (!profileAgent) throw new Error('Local Assignment Grant Agent is outside the pinned Profile');
  const planFacts = events.filter(event => event.type === 'plan.admitted');
  if (planFacts.length !== 1) throw new Error('Local Assignment Grant requires one admitted Plan');
  const planFact = planFacts[0]!;
  const plan = planFact.payload.plan as WorkflowPlanProposal;
  assertWorkflowPlanProposal(plan);
  if (plan.projectId !== request.projectId) {
    throw new Error('Local Assignment Grant Plan Project scope drift');
  }
  if (plan.authority.profileRevisionId !== pin.profileRevisionId
    || plan.authority.profileDigest !== pin.profileDigest) {
    throw new Error('Local Assignment Grant Plan Profile pin drift');
  }
  if (plan.authority.projectRevision !== catalog.revision) {
    throw new Error('Local Assignment Grant Plan Catalog revision drift');
  }
  if (plan.authority.projectDigest !== digestWorkroomCatalogProjectBinding(definition)) {
    throw new Error('Local Assignment Grant Plan Catalog binding drift');
  }
  const plannedTask = plan.tasks.find(candidate => candidate.key === request.taskKey);
  if (!plannedTask || plannedTask.role !== decision.role) {
    throw new Error('Local Assignment Grant Task is absent from the admitted Plan');
  }
  const tools = profileAgent.allowedTools.map(name => {
    const tool = revision.compiledProfile.tools.find(candidate => candidate.id === name);
    if (!tool) throw new Error(`Local Assignment Grant Tool ${name} is absent from the pinned Profile`);
    return Object.freeze({ name: tool.id, digest: tool.digest });
  });
  const skills = profileAgent.allowedSkills.map(name => {
    const skill = revision.compiledProfile.skills.find(candidate => candidate.id === name);
    if (!skill) throw new Error(`Local Assignment Grant Skill ${name} is absent from the pinned Profile`);
    return Object.freeze({
      name: skill.id,
      digest: skill.digest,
      requiredTools: skill.requiresTools,
    });
  });
  const factDigest = digestCanonicalWorkroomValue(events);
  const factAnchor = Object.freeze({
    ref: `workroom-journal:${encodeURIComponent(request.runId)}:${state.sequence}`,
    sequence: state.sequence,
    digest: factDigest,
  });
  const capabilityRevision = pin.activationRegistryRevision + 1;
  const ceiling = (id: string, revisionNumber: number) =>
    Object.freeze({ id, revision: revisionNumber, tools, skills });
  const grant = createWorkroomAssignmentAuthorityGrant({
    generation: options.generation,
    projectId: request.projectId,
    runId: request.runId,
    taskKey: request.taskKey,
    taskRevision: request.taskRevision,
    assignmentId: request.assignmentId,
    assignmentRevision: request.assignmentRevision,
    attempt: request.attempt,
    fence: request.fence,
    agentDefinitionId: request.requestedAgentDefinitionId,
    catalogRevision: catalog.revision,
    catalogBindingDigest: digestWorkroomCatalogProjectBinding(definition),
    profileRevisionId: pin.profileRevisionId,
    profileDigest: pin.profileDigest,
    principalId: `agent:${request.requestedAgentDefinitionId}`,
    role: decision.role,
    capabilitySnapshotRef:
      `local-capability:${encodeURIComponent(request.assignmentId)}:${request.assignmentRevision}`,
    capabilitySnapshotRevision: capabilityRevision,
    roleCapabilities: ceiling(`role:${decision.role}:${pin.profileRevisionId}`, capabilityRevision),
    taskCapabilities: ceiling(`task:${request.taskKey}:${request.taskRevision}`, request.taskRevision),
    policyCapabilities: ceiling(`policy:${pin.profileRevisionId}`, capabilityRevision),
    plan: Object.freeze({
      ref: `workflow-plan:${encodeURIComponent(plan.proposalId)}`,
      revision: planFact.sequence + 1,
      digest: plan.digest,
    }),
    contextPolicy: Object.freeze({
      ref: `planning-policy:${encodeURIComponent(plan.authority.planningPolicyRevisionId)}`,
      revision: planFact.sequence + 1,
      digest: plan.authority.planningPolicyDigest,
    }),
    policySnapshot: Object.freeze({
      ref: `workroom-profile:${encodeURIComponent(pin.profileRevisionId)}`,
      revision: capabilityRevision,
      digest: pin.profileDigest,
    }),
    workspace: Object.freeze({
      leaseRef: `local-workspace:${encodeURIComponent(request.assignmentId)}:${request.fence}`,
      mountRef: options.projectRoot,
      baseRevision: plan.digest,
      fence: request.fence,
    }),
    contextView: Object.freeze({ ref: factAnchor.ref, hash: factDigest }),
    capabilityGrantRef:
      `local-grant:${encodeURIComponent(request.assignmentId)}:${request.assignmentRevision}`,
  });
  const assignmentKey = assignmentAuthorityGrantKey({ ...request, generation: options.generation });
  const current = await options.repository.read(assignmentKey);
  const now = Date.now();
  const record = createAssignmentAuthorityGrantRecord({
    assignmentKey,
    revision: (current?.revision ?? 0) + 1,
    ...(current ? { previousDigest: current.digest } : {}),
    generation: options.generation,
    projectId: request.projectId,
    runId: request.runId,
    taskKey: request.taskKey,
    taskRevision: request.taskRevision,
    assignmentId: request.assignmentId,
    assignmentRevision: request.assignmentRevision,
    attempt: request.attempt,
    fence: request.fence,
    operationId: decision.decisionId,
    agentDefinitionId: request.requestedAgentDefinitionId,
    profileRevisionId: pin.profileRevisionId,
    profileDigest: pin.profileDigest,
    factAnchor,
    createdAt: now,
    expiresAt: now + LOCAL_ASSIGNMENT_GRANT_TTL_MS,
    status: 'ready',
    grant,
  });
  try {
    return (await options.repository.append(record, current?.digest)).record.grant;
  } catch (error) {
    const winner = await options.repository.read(assignmentKey);
    if (winner?.status === 'ready' && winner.grant) return winner.grant;
    throw error;
  }
}

interface LocalPortfolioContext {
  readonly portfolioId: string;
  readonly projectId: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly workroomCatalogRevision: string;
  readonly tenantId: string;
  readonly policy: ReturnType<typeof createPortfolioPolicySnapshot>;
  readonly catalog: ReturnType<typeof createResourcePoolCatalogSnapshot>;
  readonly ceiling: ReturnType<typeof createAtomicResourceBundleProfileCeiling>;
  readonly profileAuthority: Readonly<{
    tenantId: string;
    projectId: string;
    profileRevisionId: string;
    profileDigest: string;
    resourceCeilingDigest: string;
  }>;
}

/** Installs the bounded single-Root Portfolio authority for local Workroom execution. */
export function installLocalWorkroomPortfolioAuthorities(options: Readonly<{
  generation: number;
  resources: Pick<Scope, 'has' | 'provide'>;
  catalog: Pick<WorkroomCatalog, 'read'>;
  profiles: Pick<ProjectProfileRegistry, 'read'>;
  portfolioJournal: Pick<PortfolioJournalRepository, 'read'>;
}>): void {
  const contexts = new Map<string, LocalPortfolioContext>();
  const resolveContext = async (
    input: Parameters<WorkroomSchedulerPortfolioScopeAuthorityPort['resolve']>[0],
  ): Promise<LocalPortfolioContext | undefined> => {
    const workroomCatalog = await options.catalog.read();
    const definition = workroomCatalog.definitions[input.projectId];
    if (!definition || definition.enabled === false
      || workroomCatalog.revision !== input.workroomCatalogRevision) return undefined;
    const registry = await options.profiles.read(input.projectId);
    const revision = registry.revisions[input.profileRevisionId];
    if (!revision || revision.projectId !== input.projectId
      || revision.compiledDigest !== input.profileDigest
      || revision.compiledProfile.projectId !== input.projectId
      || revision.compiledProfile.revisionId !== input.profileRevisionId
      || revision.compiledProfile.digest !== input.profileDigest) return undefined;
    const tenantId = 'workroom-local';
    const identity = stableDigest({
      projectId: input.projectId,
      workroomCatalogRevision: input.workroomCatalogRevision,
      profileRevisionId: input.profileRevisionId,
      profileDigest: input.profileDigest,
    });
    const portfolioId = `workroom-local:${identity.slice('sha256:'.length)}`;
    const existing = contexts.get(portfolioId);
    if (existing) return existing;
    const catalog = createResourcePoolCatalogSnapshot({
      generationId: `workroom-local:${input.workroomCatalogRevision}`,
      revision: 1,
      tenantId,
      pools: [
        {
          kind: 'model', poolId: LOCAL_WORKROOM_MODEL_POOL_ID, tenantId,
          region: 'local', trustDomain: 'root', compatibilityGroup: 'local-v1',
          capacityUnits: 64, maxCapacityUnitsPerBundle: 1,
          rateUnitsPerWindow: 1_000_000, maxRateUnitsPerBundle: 1,
          priceMicrosPerUsageUnit: 0, maxUsageUnitsPerBundle: 1,
          providerId: 'root-model', modelTier: 'configured',
        },
        {
          kind: 'executor', poolId: LOCAL_WORKROOM_EXECUTOR_POOL_ID, tenantId,
          region: 'local', trustDomain: 'root', compatibilityGroup: 'local-v1',
          capacityUnits: 64, maxCapacityUnitsPerBundle: 1,
          rateUnitsPerWindow: 1_000_000, maxRateUnitsPerBundle: 1,
          priceMicrosPerUsageUnit: 0, maxUsageUnitsPerBundle: 1,
          executorPoolId: 'root-local', sandboxId: 'configured',
          workspaceProviderId: 'configured',
        },
      ],
    });
    const allowedPools = [LOCAL_WORKROOM_EXECUTOR_POOL_ID, LOCAL_WORKROOM_MODEL_POOL_ID];
    const policy = createPortfolioPolicySnapshot({
      revision: 1,
      globalBudgetMicros: 0,
      offerTtlTicks: 30,
      leaseTtlTicks: 300,
      leaseHeartbeatTicks: 60,
      maxLeaseQuantumTicks: 3_600,
      maxLeaseRenewals: 11,
      reclaimTtlTicks: 30,
      pools: {
        [LOCAL_WORKROOM_MODEL_POOL_ID]: {
          poolId: LOCAL_WORKROOM_MODEL_POOL_ID, capacityUnits: 64,
          rateUnitsPerWindow: 1_000_000, rateWindowTicks: 60,
          priceMicrosPerBudgetUnit: 0,
        },
        [LOCAL_WORKROOM_EXECUTOR_POOL_ID]: {
          poolId: LOCAL_WORKROOM_EXECUTOR_POOL_ID, capacityUnits: 64,
          rateUnitsPerWindow: 1_000_000, rateWindowTicks: 60,
          priceMicrosPerBudgetUnit: 0,
        },
      },
      projects: {
        [input.projectId]: {
          projectId: input.projectId, revision: 1, lane: 'normal', weight: 1,
          hardBudgetMicros: 0, allowedPools, maxOutstandingRequests: 64,
          maxConcurrentGrants: 8, burstLimit: 16, starvationTicks: 30, status: 'active',
        },
      },
    });
    const ceiling = createAtomicResourceBundleProfileCeiling({
      tenantId,
      projectId: input.projectId,
      profileRevisionId: input.profileRevisionId,
      profileDigest: input.profileDigest,
      catalogRevision: catalog.revision,
      catalogDigest: catalog.digest,
      allowedPoolIds: allowedPools,
      poolLimits: [
        { poolId: LOCAL_WORKROOM_MODEL_POOL_ID, maxCapacityUnits: 1, maxRateUnits: 1, maxUsageUnits: 1 },
        { poolId: LOCAL_WORKROOM_EXECUTOR_POOL_ID, maxCapacityUnits: 1, maxRateUnits: 1, maxUsageUnits: 1 },
      ],
      maxWorstCaseCostMicros: 0,
    });
    const profileAuthority = Object.freeze({
      tenantId,
      projectId: input.projectId,
      profileRevisionId: input.profileRevisionId,
      profileDigest: input.profileDigest,
      resourceCeilingDigest: ceiling.ceilingDigest,
    });
    const context = Object.freeze({
      portfolioId, projectId: input.projectId,
      profileRevisionId: input.profileRevisionId, profileDigest: input.profileDigest,
      workroomCatalogRevision: input.workroomCatalogRevision,
      tenantId, policy, catalog, ceiling, profileAuthority,
    });
    contexts.set(portfolioId, context);
    return context;
  };

  if (!options.resources.has(workroomSchedulerPortfolioScopeAuthorityToken)) {
    options.resources.provide(workroomSchedulerPortfolioScopeAuthorityToken, Object.freeze({
      resolve: async (input: Parameters<WorkroomSchedulerPortfolioScopeAuthorityPort['resolve']>[0]) => {
        if (input.generation !== options.generation) return undefined;
        const context = await resolveContext(input);
        if (!context) return undefined;
        const body = Object.freeze({
          version: 1 as const,
          generation: options.generation,
          projectId: context.projectId,
          workroomCatalogRevision: context.workroomCatalogRevision,
          profileRevisionId: context.profileRevisionId,
          profileDigest: context.profileDigest,
          portfolioId: context.portfolioId,
          tenantId: context.tenantId,
          portfolioPolicyRevision: context.policy.revision,
          portfolioPolicyDigest: context.policy.digest,
          portfolioClockAnchor: 0,
          portfolioClockDigest: stableDigest({ portfolioId: context.portfolioId, now: 0 }),
          resourceCatalogGenerationId: context.catalog.generationId,
          resourceCatalogRevision: context.catalog.revision,
          resourceCatalogDigest: context.catalog.digest,
        });
        return Object.freeze({
          ...body,
          bindingDigest: workroomSchedulerPortfolioScopeBindingDigest(body),
        });
      },
    }));
  }
  if (!options.resources.has(portfolioPolicyAuthorityToken)) {
    options.resources.provide(portfolioPolicyAuthorityToken, Object.freeze({
      resolve: async (portfolioId: Parameters<PortfolioPolicyAuthorityPort['resolve']>[0]) => {
        const context = contexts.get(portfolioId);
        if (!context) return undefined;
        return Object.freeze({
          policy: context.policy,
          governance: Object.freeze({
            principalId: 'workroom-admin',
            authorizedBy: 'root:local-workroom-portfolio',
            reasonDigest: stableDigest({ portfolioId, reason: 'local-workroom-bootstrap' }),
            targetDigest: context.policy.digest,
            expectedRevision: 0,
          }),
        });
      },
    }));
  }
  if (!options.resources.has(portfolioAtomicBundleAuthorityToken)) {
    options.resources.provide(portfolioAtomicBundleAuthorityToken, Object.freeze({
      validate: async (input: Parameters<PortfolioAtomicBundleAuthorityPort['validate']>[0]) => {
        if (input.generation !== options.generation) return undefined;
        const context = contexts.get(input.portfolioId);
        if (!context || input.tenantId !== context.tenantId
          || input.capacityRequest.projectId !== context.projectId
          || input.capacityRequest.workRef.profileRevisionId !== context.profileRevisionId
          || input.capacityRequest.workRef.profileDigest !== context.profileDigest) return undefined;
        return validateAtomicResourceBundle({
          request: {
            tenantId: input.tenantId,
            catalogRevision: input.catalogRevision,
            catalogDigest: input.catalogDigest,
            capacityRequest: input.capacityRequest,
          },
          catalog: context.catalog,
          profileCeiling: context.ceiling,
          profileAuthority: context.profileAuthority,
        });
      },
    }));
  }
  if (!options.resources.has(portfolioKernelCommandAuthorityToken)) {
    options.resources.provide(portfolioKernelCommandAuthorityToken, Object.freeze({
      authorize: async (input: Parameters<PortfolioKernelCommandAuthorityPort['authorize']>[0]) => {
        if (input.generation !== options.generation || input.action !== 'consume'
          || !input.assignmentRef.trim() || !input.portfolioId.startsWith('workroom-local:')) {
          return undefined;
        }
        const state = replayPortfolioAdmission(
          input.portfolioId,
          await options.portfolioJournal.read(input.portfolioId),
        );
        const grant = state.grants[input.grant.grantId];
        const request = grant && state.requests[grant.requestId]?.request;
        const context = contexts.get(input.portfolioId);
        if (!grant || !request || request.projectId !== grant.projectId
          || (context !== undefined && grant.projectId !== context.projectId)
          || (grant.status !== 'offered' && grant.status !== 'consumed')
          || (grant.status === 'consumed' && grant.assignmentRef !== input.assignmentRef)
          || digestCanonicalWorkroomValue(grant) !== digestCanonicalWorkroomValue(input.grant)) {
          return undefined;
        }
        const claims = Object.freeze({
          portfolioId: input.portfolioId,
          action: 'consume' as const,
          projectId: grant.projectId,
          requestId: grant.requestId,
          grantId: grant.grantId,
          fence: grant.fence,
          assignmentRef: input.assignmentRef,
        });
        return Object.freeze({
          ...claims,
          commandDigest: portfolioKernelCommandDigest(claims),
          authorizedBy: `root:local-workroom-portfolio:${options.generation}`,
        });
      },
    }));
  }
}

function stableDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
