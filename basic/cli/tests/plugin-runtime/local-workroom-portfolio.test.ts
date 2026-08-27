import { createHash } from 'node:crypto';
import { rootPluginId, Scope } from '@zhin.js/plugin-runtime';
import {
  createDurableWorkroomAssignmentAuthorityGrantProvider,
  createWorkroomSchedulerPolicySnapshot,
  decideWorkroomSchedule,
  MemoryAssignmentAuthorityGrantRepository,
  MemoryWorkroomJournal,
  WorkflowPlanBuilder,
  WorkroomKernel,
  workroomLocalAssignmentId,
  type WorkroomCatalogSnapshot,
} from '@zhin.js/agent';
import {
  digestWorkroomCatalogProjectBinding,
  portfolioAtomicBundleAuthorityToken,
  portfolioPolicyAuthorityToken,
  workroomSchedulerPortfolioScopeAuthorityToken,
} from '@zhin.js/agent/runtime';
import {
  createLocalWorkroomAssignmentGrantProvider,
  installLocalWorkroomPortfolioAuthorities,
  LOCAL_WORKROOM_EXECUTOR_POOL_ID,
  LOCAL_WORKROOM_MODEL_POOL_ID,
  LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
} from '../../src/plugin-runtime/local-workroom-portfolio.js';

const generation = 7;
const projectId = 'project-1';
const profileRevisionId = 'profile-1';
const profileDigest = sha('p');

describe('CLI local Workroom Portfolio authorities', () => {
  it('materializes and durably replays an exact local Assignment grant', async () => {
    const catalog = catalogSnapshot();
    const journal = new MemoryWorkroomJournal();
    const kernel = new WorkroomKernel({
      journal,
      now: () => 100,
      acceptancePolicy: acceptancePolicy(),
    });
    const plan = WorkflowPlanBuilder.create({
      proposalId: 'plan-1',
      projectId,
      parameterDigest: sha('a'),
      strategy: { id: 'strategy-1', version: '1', digest: sha('b') },
      authority: {
        projectRevision: catalog.revision,
        projectDigest: digestWorkroomCatalogProjectBinding(catalog.definitions[projectId]!),
        profileRevisionId,
        profileDigest,
        planningPolicyRevisionId: 'planning-1',
        planningPolicyDigest: sha('c'),
        orchestratorAgentDefinitionId: 'orchestrator',
        orchestratorAuthorityDigest: sha('d'),
      },
      budget: { maxTasks: 2, maxTotalAttempts: 4 },
      schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
        policyRef: 'scheduler-1', revision: 1, pinnedAtSequence: 1, capacity: 1,
        agingStepMs: 100,
        starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
        preemptionDeadlineMs: 50,
      }),
    }).addTask({
      key: 'build', title: 'Build', role: 'executor', required: true, maxAttempts: 2,
      dependsOn: [], requires: {}, resourceRequirements: LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
      scheduler: {
        sponsorLane: 'normal', localRank: 0, enqueuedAt: 100,
        deadline: 1_000, preemptibility: 'atomic',
      },
    }).build();
    const admitted = await kernel.admitWorkflowPlan({
      operationId: 'admit-1', projectId, title: 'Local Workroom',
      sourceEventRef: 'conversation:1', sourceEventDigest: sha('e'),
      orchestratorAgentDefinitionId: 'orchestrator', plan,
    });
    await kernel.pinTaskAcceptance(projectId, admitted.runId, 'build');
    const decision = decideWorkroomSchedule(await journal.read(admitted.runId));
    if (!decision || decision.type !== 'dispatch_task') throw new Error('fixture must dispatch');
    await kernel.commitSchedulerDecision(decision);

    const repository = new MemoryAssignmentAuthorityGrantRepository();
    const durable = createDurableWorkroomAssignmentAuthorityGrantProvider({
      repository, generation, now: () => 101,
    });
    const profile = profileRegistry(admitted.runId);
    const provider = createLocalWorkroomAssignmentGrantProvider({
      generation,
      projectRoot: '/workspace/project-1',
      repository,
      durable,
      journal,
      catalog: { read: async () => catalog },
      profiles: { read: async () => profile },
      runState: kernel,
    });
    const request = {
      projectId,
      runId: admitted.runId,
      taskKey: 'build',
      taskRevision: 1,
      assignmentId: workroomLocalAssignmentId(decision.decisionId),
      assignmentRevision: 1,
      attempt: 1,
      fence: 1,
      requestedAgentDefinitionId: 'developer',
    };

    const first = await provider.resolve(request);
    expect(first).toMatchObject({
      generation,
      projectId,
      runId: admitted.runId,
      taskKey: 'build',
      principalId: 'agent:developer',
      role: 'executor',
      workspace: { mountRef: '/workspace/project-1', fence: 1 },
      roleCapabilities: {
        tools: [{ name: 'read_file', digest: sha('1') }],
        skills: [{ name: 'typescript', digest: sha('2'), requiredTools: ['read_file'] }],
      },
    });
    await expect(provider.resolve(request)).resolves.toEqual(first);
    await expect(provider.resolve({ ...request, requestedEndpointId: 'remote-1' }))
      .resolves.toBeUndefined();
  });

  it('installs bounded local scope, policy, and bundle authorities without replacing plugins', async () => {
    const resources = new Scope(rootPluginId());
    const catalog = catalogSnapshot();
    const profile = profileRegistry('run-1');
    installLocalWorkroomPortfolioAuthorities({
      generation,
      resources,
      catalog: { read: async () => catalog },
      profiles: { read: async () => profile },
      portfolioJournal: { read: async () => [] },
    });
    const scope = resources.use(workroomSchedulerPortfolioScopeAuthorityToken);
    const binding = await scope.resolve({
      generation,
      projectId,
      workroomCatalogRevision: catalog.revision,
      profileRevisionId,
      profileDigest,
    });
    expect(binding).toMatchObject({
      generation,
      projectId,
      tenantId: 'workroom-local',
      resourceCatalogRevision: 1,
    });
    expect(binding?.portfolioId).toMatch(/^workroom-local:/u);
    await expect(scope.resolve({
      generation: generation + 1,
      projectId,
      workroomCatalogRevision: catalog.revision,
      profileRevisionId,
      profileDigest,
    })).resolves.toBeUndefined();

    const policy = await resources.use(portfolioPolicyAuthorityToken).resolve(binding!.portfolioId);
    expect(policy?.policy.projects[projectId]).toMatchObject({
      allowedPools: [LOCAL_WORKROOM_EXECUTOR_POOL_ID, LOCAL_WORKROOM_MODEL_POOL_ID],
      status: 'active',
    });
    const bundleAuthority = resources.use(portfolioAtomicBundleAuthorityToken);
    const capacityRequest = {
      requestId: 'request-1',
      projectId,
      workRef: { runId: 'run-1', profileRevisionId, profileDigest },
      schedulerRevision: sha('s'), schedulerSequence: 3, localOrder: 3,
      projectPolicyRevision: 1, opaqueHeadId: 'head-1', payloadDigest: sha('h'),
      resourceBundle: LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
      preemptibility: 'atomic' as const,
      starvationAt: 10,
    };
    const validated = await bundleAuthority.validate({
      generation,
      portfolioId: binding!.portfolioId,
      tenantId: binding!.tenantId,
      catalogRevision: binding!.resourceCatalogRevision,
      catalogDigest: binding!.resourceCatalogDigest,
      capacityRequest,
    });
    expect(validated).toMatchObject({
      requestId: 'request-1',
      projectId,
      model: { poolId: LOCAL_WORKROOM_MODEL_POOL_ID },
      executor: { poolId: LOCAL_WORKROOM_EXECUTOR_POOL_ID },
    });
  });
});

function acceptancePolicy() {
  return {
    pinContract: (input: Readonly<{ task: Readonly<{ key: string; revision: number }> }>) => ({
      id: `contract:${input.task.key}:${input.task.revision}`,
      revision: 1,
      digest: sha('f'),
      taskKey: input.task.key,
      taskRevision: input.task.revision,
      kind: 'task_result' as const,
      policy: { id: 'acceptance-1', revision: 1, digest: sha('g') },
      criteria: [{ id: 'review', kind: 'judgment' as const, description: 'Review result' }],
      requiredEvidence: [],
    }),
    decide: () => { throw new Error('not used'); },
  };
}

function catalogSnapshot(): WorkroomCatalogSnapshot {
  return Object.freeze({
    revision: 'a'.repeat(64),
    definitions: Object.freeze({
      [projectId]: Object.freeze({
        name: 'Project One',
        enabled: true,
        sponsors: Object.freeze(['workroom-admin']),
        members: Object.freeze([
          Object.freeze({ agent: 'orchestrator', role: 'orchestrator' as const }),
          Object.freeze({ agent: 'developer', role: 'executor' as const }),
        ]),
        conversation: Object.freeze({
          adapter: 'sandbox', endpoint: 'sandbox-1', kind: 'group' as const,
          id: 'project-1', agent: 'orchestrator',
        }),
      }),
    }),
  });
}

function profileRegistry(runId: string) {
  const compiledProfile = Object.freeze({
    revisionId: profileRevisionId,
    projectId,
    digest: profileDigest,
    tools: Object.freeze([{ id: 'read_file', digest: sha('1') }]),
    skills: Object.freeze([{ id: 'typescript', digest: sha('2'), requiresTools: ['read_file'] }]),
    agents: Object.freeze([{
      id: 'developer', digest: sha('3'), role: 'executor' as const,
      allowedTools: ['read_file'], allowedSkills: ['typescript'],
    }]),
  });
  return {
    projectId,
    registryRevision: 2,
    runPins: {
      [runId]: {
        projectId, runId, profileRevisionId, profileDigest,
        activationRegistryRevision: 1, pinnedAtRegistryRevision: 2,
      },
    },
    revisions: {
      [profileRevisionId]: {
        revisionId: profileRevisionId,
        projectId,
        compiledDigest: profileDigest,
        compiledProfile,
      },
    },
  } as never;
}

function sha(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
