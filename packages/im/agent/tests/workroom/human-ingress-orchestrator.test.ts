import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryConversationEventStore,
  conversationRefKey,
  messageRefKey,
  type ConversationEvent,
} from '@zhin.js/im-contract';
import {
  FileWorkroomJournal,
  MemoryWorkroomJournal,
  MemoryWorkroomJournalPayloadPort,
} from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import {
  ConversationEventHumanIngressSourceReader,
  digestHumanIngressConversationEvent,
} from '../../src/workroom/human-ingress-source-reader.js';
import {
  ProductionHumanIngressOrchestratorPort,
  WorkroomPlanningClarificationError,
  createPlanGateHumanIngressControlPort,
} from '../../src/workroom/human-ingress-orchestrator.js';
import {
  DynamicWorkflowPlanningPort,
  type DynamicWorkflowPlanningAuthority,
} from '../../src/workroom/dynamic-workflow-planner.js';
import type { HumanIngressApplicationRequest } from '../../src/workroom/human-ingress-application.js';
import {
  createWorkroomSchedulerPolicySnapshot,
  decideWorkroomSchedule,
} from '../../src/workroom/workroom-scheduler.js';

const conversation = Object.freeze({
  endpoint: Object.freeze({ adapter: 'adapter', id: 'bot' }),
  kind: 'group' as const,
  id: 'group-1',
});

const projectAuthority = Object.freeze({
  orchestratorAgentDefinitionId: 'orchestrator-1',
  projectRevision: 'catalog-1',
  projectDigest: `sha256:${'1'.repeat(64)}`,
  orchestratorAuthorityDigest: `sha256:${'2'.repeat(64)}`,
});

const planningAuthority: DynamicWorkflowPlanningAuthority = Object.freeze({
  version: 1,
  projectId: 'project-1',
  ...projectAuthority,
  profile: Object.freeze({
    revisionId: 'profile-1', digest: `sha256:${'3'.repeat(64)}`,
    strategies: Object.freeze([{ id: 'strategy:dynamic', version: '1.0.0', digest: `sha256:${'4'.repeat(64)}` }]),
    roles: Object.freeze(['architect', 'developer']),
    capabilities: Object.freeze({
      tools: Object.freeze(['tool:repo']), skills: Object.freeze([]),
      integrations: Object.freeze([]), authorities: Object.freeze(['repo:read']),
    }),
  }),
  policy: Object.freeze({
    revisionId: 'policy-1', digest: `sha256:${'5'.repeat(64)}`,
    maxTasks: 4, maxTotalAttempts: 8, maxAttemptsPerTask: 3,
    allowOptionalTasks: true, approvalRequiredAuthorities: Object.freeze([]),
    sponsorGate: Object.freeze({ owner: 'project-sponsor', decisionTimeoutMs: 60_000 }),
    schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
      policyRef: 'scheduler-policy:project-1', revision: 1, pinnedAtSequence: 1,
      capacity: 2, agingStepMs: 1_000,
      starvationBoundMs: { urgent: 5_000, high: 10_000, normal: 20_000, low: 30_000 },
      preemptionDeadlineMs: 2_000,
    }),
    defaultSponsorLane: 'normal', defaultTaskDeadlineMs: 86_400_000,
    defaultPreemptibility: 'checkpointable',
  }),
});

function dynamicPlanning(): DynamicWorkflowPlanningPort {
  return new DynamicWorkflowPlanningPort({
    resolveAuthority: async () => planningAuthority,
    planner: { propose: async () => ({
      version: 1,
      strategy: planningAuthority.profile.strategies[0],
      tasks: [
        {
          key: 'design', title: 'Design durable admission', role: 'architect', required: true,
          maxAttempts: 1, localRank: 10, dependsOn: [], approval: 'none',
          requires: { tools: ['tool:repo'], skills: [], integrations: [], authorities: ['repo:read'] },
        },
        {
          key: 'implement', title: 'Implement durable admission', role: 'developer', required: true,
          maxAttempts: 2, localRank: 20, dependsOn: ['design'], approval: 'none',
          requires: { tools: ['tool:repo'], skills: [], integrations: [], authorities: ['repo:read'] },
        },
      ],
    }) },
  });
}

function sourceEvent(text = '/work implement durable admission'): ConversationEvent {
  const ref = Object.freeze({ conversation, id: 'message-1' });
  return Object.freeze({
    eventId: `message:${messageRefKey(ref)}`,
    conversation,
    timestamp: 100,
    type: 'message.created' as const,
    message: Object.freeze({
      ref,
      actor: Object.freeze({ id: 'human-1' }),
      segments: Object.freeze([{ type: 'text', data: Object.freeze({ text }) }]),
      timestamp: 100,
    }),
  });
}

function request(kind: 'discussion' | 'work_request' | 'control', event: ConversationEvent): HumanIngressApplicationRequest {
  const sourceDigest = digestHumanIngressConversationEvent(1, event);
  const proposalId = `proposal-${kind}`;
  const proposalDigest = `sha256:${'a'.repeat(64)}`;
  return Object.freeze({
    version: 1,
    kind,
    identity: Object.freeze({
      projectId: 'project-1', proposalId, proposalDigest,
      operationId: `human-ingress-application:${proposalId}`,
    }),
    operationId: `human-ingress-application:${proposalId}`,
    attempt: 1,
    fence: 1,
    proposal: Object.freeze({
      version: 1,
      id: proposalId,
      digest: proposalDigest,
      status: 'proposed',
      kind: 'project_inbox',
      projectId: 'project-1',
      space: 'workroom',
      bindingRevision: 1,
      bindingDigest: `sha256:${'b'.repeat(64)}`,
      sourceEvent: Object.freeze({
        ref: `conversation-event:${event.eventId}`,
        digest: sourceDigest,
        sequence: 1,
        conversationKey: conversationRefKey(conversation),
      }),
      principal: Object.freeze({
        ref: 'principal:human-1', revision: 1, digest: `sha256:${'c'.repeat(64)}`,
        principalId: 'owner:human-1', subjectId: 'human-1',
      }),
      intent: kind,
      resolverRef: 'resolver:v1',
      resolverDigest: `sha256:${'d'.repeat(64)}`,
      authorityRequirement: kind === 'control' ? 'workroom_control' : 'none',
      target: Object.freeze({ orchestrator: true, agentDefinitionId: 'orchestrator-1' }),
    }),
  });
}

describe('production human ingress Orchestrator admission', () => {
  it('reads the exact canonical durable source and rejects digest or sequence drift', async () => {
    const store = new MemoryConversationEventStore();
    const event = sourceEvent();
    await store.append(event);
    const reader = new ConversationEventHumanIngressSourceReader(store);
    const valid = request('work_request', event).proposal.sourceEvent;

    await expect(reader.read(valid)).resolves.toMatchObject({
      eventId: event.eventId,
      text: '/work implement durable admission',
      sequence: 1,
    });
    await expect(reader.read({ ...valid, digest: `sha256:${'0'.repeat(64)}` }))
      .rejects.toThrow('digest');
    await expect(reader.read({ ...valid, sequence: 2 }))
      .rejects.toThrow('not found');
  });

  it('reads a source whose runtime Endpoint identity contains canonical separators', async () => {
    const runtimeConversation = Object.freeze({
      endpoint: Object.freeze({
        adapter: 'root/icqq',
        id: 'root/icqq\0zhin.adapter\0icqq~8596238',
      }),
      kind: 'group' as const,
      id: '129043431',
    });
    const ref = Object.freeze({ conversation: runtimeConversation, id: 'message-runtime-1' });
    const event = Object.freeze({
      eventId: `message:${messageRefKey(ref)}`,
      conversation: runtimeConversation,
      timestamp: 100,
      type: 'message.created' as const,
      message: Object.freeze({
        ref,
        actor: Object.freeze({ id: 'human-1' }),
        segments: Object.freeze([{ type: 'text', data: Object.freeze({ text: '@bot hello' }) }]),
        timestamp: 100,
      }),
    });
    const store = new MemoryConversationEventStore();
    await store.append(event);

    await expect(new ConversationEventHumanIngressSourceReader(store).read({
      ref: `conversation-event:${event.eventId}`,
      digest: digestHumanIngressConversationEvent(1, event),
      sequence: 1,
      conversationKey: conversationRefKey(runtimeConversation),
    })).resolves.toMatchObject({
      eventId: event.eventId,
      text: '@bot hello',
      sequence: 1,
      event: { conversation: runtimeConversation },
    });
  });

  it('turns explicit work into a typed Plan admission and replays the same operation without duplicate Tasks', async () => {
    const store = new MemoryConversationEventStore();
    const event = sourceEvent();
    await store.append(event);
    let id = 0;
    const journal = new MemoryWorkroomJournal();
    const kernel = new WorkroomKernel({ journal, now: () => 100, createId: () => `id-${++id}` });
    const afterPlanAdmission = vi.fn(async () => undefined);
    const port = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(store),
      kernel,
      resolveProject: async () => projectAuthority,
      authorizeProjectSource: async () => true,
      planning: dynamicPlanning(),
      afterPlanAdmission,
    });
    const input = request('work_request', event);

    const first = await port.apply(input);
    const second = await port.apply({ ...input, attempt: 2, fence: 2 });

    expect(second).toEqual(first);
    expect(first).toMatchObject({ status: 'applied', kind: 'plan_proposal_submitted' });
    const runs = await kernel.list('project-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      title: 'implement durable admission',
      tasks: { design: { title: 'Design durable admission' }, implement: { title: 'Implement durable admission' } },
    });
    expect((await journal.read(runs[0]!.runId)).map(item => item.type))
      .toEqual(['run.created', 'plan.admitted', 'task.planned', 'task.planned']);
    expect(afterPlanAdmission).toHaveBeenCalledTimes(2);
    expect(afterPlanAdmission).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: input.operationId,
      projectId: 'project-1',
      plan: expect.objectContaining({ proposalId: input.operationId }),
      receipt: expect.objectContaining({ runId: runs[0]!.runId }),
    }));
  });

  it('records discussion only through a non-authoritative proposal port and refuses uninstalled typed control', async () => {
    const store = new MemoryConversationEventStore();
    const event = sourceEvent('hello team');
    await store.append(event);
    const discussions = { propose: vi.fn(async () => Object.freeze({
      receiptRef: 'discussion:1', receiptDigest: `sha256:${'e'.repeat(64)}`,
    })) };
    const kernel = new WorkroomKernel({ journal: new MemoryWorkroomJournal() });
    const port = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(store),
      kernel,
      resolveProject: async () => projectAuthority,
      authorizeProjectSource: async () => true,
      planning: dynamicPlanning(),
      discussions,
    });

    await expect(port.apply(request('discussion', event))).resolves.toMatchObject({
      status: 'applied', kind: 'discussion_recorded', receiptRef: 'discussion:1',
    });
    expect(discussions.propose).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'human-ingress-application:proposal-discussion',
      authority: 'non_authoritative',
      text: 'hello team',
    }));
    await expect(port.apply(request('control', event))).resolves.toMatchObject({
      status: 'clarification_required', reason: 'unauthorized_control',
    });
    expect(await kernel.list('project-1')).toEqual([]);
  });

  it('fails closed when Catalog Orchestrator ownership drifts', async () => {
    const store = new MemoryConversationEventStore();
    const event = sourceEvent();
    await store.append(event);
    const port = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(store),
      kernel: new WorkroomKernel({ journal: new MemoryWorkroomJournal() }),
      resolveProject: async () => Object.freeze({ ...projectAuthority, orchestratorAgentDefinitionId: 'other' }),
      authorizeProjectSource: async () => true,
      planning: dynamicPlanning(),
    });

    await expect(port.apply(request('work_request', event))).rejects.toThrow('Orchestrator binding');
  });

  it('asks for explicit planning setup instead of silently creating a fixed single Task', async () => {
    const store = new MemoryConversationEventStore();
    const event = sourceEvent();
    await store.append(event);
    const kernel = new WorkroomKernel({ journal: new MemoryWorkroomJournal() });
    const port = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(store),
      kernel,
      resolveProject: async () => projectAuthority,
      authorizeProjectSource: async () => true,
    });

    await expect(port.apply(request('work_request', event))).resolves.toMatchObject({
      status: 'clarification_required', reason: 'planning_unavailable',
    });
    expect(await kernel.list('project-1')).toEqual([]);
  });

  it('returns a durable-compatible clarification when P12 planning disclosure is unavailable', async () => {
    const store = new MemoryConversationEventStore();
    const event = sourceEvent();
    await store.append(event);
    const kernel = new WorkroomKernel({ journal: new MemoryWorkroomJournal() });
    const port = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(store),
      kernel,
      resolveProject: async () => projectAuthority,
      authorizeProjectSource: async () => true,
      planning: {
        propose: async () => {
          throw new WorkroomPlanningClarificationError('planning_disclosure_unavailable');
        },
      },
    });

    await expect(port.apply(request('work_request', event))).resolves.toMatchObject({
      status: 'clarification_required', reason: 'planning_disclosure_unavailable',
    });
    expect(await kernel.list('project-1')).toEqual([]);
  });

  it('materializes a trusted Sponsor Gate as a Kernel blocker before Scheduler dispatch', async () => {
    const store = new MemoryConversationEventStore();
    const event = sourceEvent('/work publish the release');
    await store.append(event);
    const journal = new MemoryWorkroomJournal();
    const authorizePlanGate = vi.fn(async (input: unknown) => Object.freeze({
      authorized: true as const,
      principalId: 'owner:human-1',
      authorizationRef: 'sponsor-authority:owner:human-1',
      input,
    }));
    const kernel = new WorkroomKernel({
      journal, now: () => 100,
      planGateAuthority: { authorize: authorizePlanGate },
    });
    const gatedAuthority: DynamicWorkflowPlanningAuthority = Object.freeze({
      ...planningAuthority,
      profile: Object.freeze({
        ...planningAuthority.profile,
        capabilities: Object.freeze({
          ...planningAuthority.profile.capabilities,
          authorities: Object.freeze(['repo:read', 'repo:write']),
        }),
      }),
      policy: Object.freeze({
        ...planningAuthority.policy,
        approvalRequiredAuthorities: Object.freeze(['repo:write']),
      }),
    });
    const planning = new DynamicWorkflowPlanningPort({
      resolveAuthority: async () => gatedAuthority,
      planner: { propose: async () => ({
        version: 1, strategy: gatedAuthority.profile.strategies[0],
        tasks: [{
          key: 'publish', title: 'Publish the release', role: 'developer', required: true,
          maxAttempts: 1, localRank: 10, dependsOn: [], approval: 'sponsor_required',
          requires: { tools: ['tool:repo'], skills: [], integrations: [], authorities: ['repo:write'] },
        }],
      }) },
    });
    const port = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(store), kernel,
      resolveProject: async () => projectAuthority,
      authorizeProjectSource: async () => true,
      planning,
    });

    const decision = await port.apply(request('work_request', event));

    expect(decision).toMatchObject({ status: 'applied', kind: 'plan_proposal_submitted' });
    const [run] = await kernel.list('project-1');
    expect(run?.tasks.publish).toMatchObject({
      status: 'blocked',
      blockers: [{ id: 'approval:publish', kind: 'approval', owner: 'project-sponsor', deadline: 60_100 }],
    });
    const events = await journal.read(run!.runId);
    expect(events.map(item => item.type))
      .toEqual(['run.created', 'plan.admitted', 'task.planned', 'task.blocked']);
    expect(decideWorkroomSchedule(events)).toBeNull();
    await expect(kernel.execute('project-1', run!.runId, {
      type: 'resolve_blocker', taskKey: 'publish', blockerId: 'approval:publish',
    })).rejects.toThrow('typed Sponsor');
    const control = createPlanGateHumanIngressControlPort(kernel);
    const controlSource = await new ConversationEventHumanIngressSourceReader(store)
      .read(request('work_request', event).proposal.sourceEvent);
    const approved = await control.apply({
      version: 1,
      operationId: 'human-control:approve-publish', projectId: 'project-1',
      projectRevision: projectAuthority.projectRevision,
      projectDigest: projectAuthority.projectDigest,
      orchestratorAgentDefinitionId: projectAuthority.orchestratorAgentDefinitionId,
      orchestratorAuthorityDigest: projectAuthority.orchestratorAuthorityDigest,
      principalId: 'owner:human-1', source: controlSource,
      authorityRequirement: 'typed_sponsor_control',
      text: `/control plan-gate approve ${run!.runId} publish approval:publish Release approved`,
    });
    expect(approved).toMatchObject({ status: 'authorized' });
    expect((await kernel.read('project-1', run!.runId)).tasks.publish)
      .toMatchObject({ status: 'ready', blockers: [] });
    expect(authorizePlanGate).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', runId: run!.runId, taskKey: 'publish', taskRevision: 1,
      gateId: 'approval:publish', planDigest: expect.stringMatching(/^sha256:/u),
      policyRevisionId: 'policy-1', policyDigest: `sha256:${'5'.repeat(64)}`,
      expectedSequence: 3, decision: 'approve',
    }));
    await expect(kernel.decidePlanApprovalGate({
      operationId: 'human-control:approve-publish',
      projectId: 'project-1', runId: run!.runId, taskKey: 'publish', taskRevision: 1,
      gateId: 'approval:publish', expectedSequence: 3,
      decision: 'approve', reason: 'Release approved',
      sponsorPrincipalId: 'owner:human-1',
      sponsorAuthorityRef: `human-ingress:${controlSource.digest}`,
    })).resolves.toMatchObject({ status: 'duplicate' });
    expect(decideWorkroomSchedule(await journal.read(run!.runId))).toMatchObject({ taskKey: 'publish' });
  });

  it('fails closed when the source sequence is outside the exact Project binding', async () => {
    const store = new MemoryConversationEventStore();
    const event = sourceEvent();
    await store.append(event);
    const port = new ProductionHumanIngressOrchestratorPort({
      sources: new ConversationEventHumanIngressSourceReader(store),
      kernel: new WorkroomKernel({ journal: new MemoryWorkroomJournal() }),
      resolveProject: async () => projectAuthority,
      authorizeProjectSource: async () => false,
      planning: dynamicPlanning(),
    });

    await expect(port.apply(request('work_request', event))).rejects.toThrow('exact Project binding');
  });

  it('recovers an exact Plan operation from the durable Journal after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-plan-admission-'));
    try {
      const event = sourceEvent();
      const store = new MemoryConversationEventStore();
      const payloads = new MemoryWorkroomJournalPayloadPort();
      await store.append(event);
      const create = () => new ProductionHumanIngressOrchestratorPort({
        sources: new ConversationEventHumanIngressSourceReader(store),
        kernel: new WorkroomKernel({ journal: new FileWorkroomJournal(directory, payloads), now: () => 100 }),
        resolveProject: async () => projectAuthority,
        authorizeProjectSource: async () => true,
        planning: dynamicPlanning(),
      });
      const input = request('work_request', event);
      const first = await create().apply(input);
      const replay = await create().apply({ ...input, attempt: 2, fence: 2 });
      expect(replay).toEqual(first);
      const journal = new FileWorkroomJournal(directory, payloads);
      const runIds = await journal.listRunIds();
      expect(runIds).toHaveLength(1);
      expect(await journal.read(runIds[0]!)).toHaveLength(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
