import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { AgentCapabilities, ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import {
  bindWorkroomCapabilityRealization,
  createDeferredCapabilityPlan,
  createWorkroomDeferredCapabilityPlan,
} from '../../src/plugin-runtime/deferred-capability-plan.js';
import {
  createCatalogWorkroomPriorityAuthority,
  workroomPriorityAuthorityReference,
} from '../../src/plugin-runtime/workroom-priority-authority.js';
import {
  WorkroomAssignmentCheckpointDelivery,
  WorkroomPreemptionRuntime,
  type WorkroomPreemptionUnavailableControlPort,
} from '../../src/plugin-runtime/workroom-preemption-runtime.js';
import { LocalWorkroomSchedulerDispatchSupply } from '../../src/plugin-runtime/workroom-local-assignment-supply.js';
import {
  WorkroomSchedulerRuntime,
  createWorkroomSchedulerKernelCommandPort,
} from '../../src/plugin-runtime/workroom-scheduler-runtime.js';
import { WorkroomLocalAssignmentRuntime } from '../../src/plugin-runtime/workroom-local-assignment-runtime.js';
import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import { AssignmentObservationIngress } from '../../src/workroom/assignment-observation-ingress.js';
import type {
  WorkroomAcceptanceContractPinInput,
  WorkroomAcceptanceDecisionInput,
  WorkroomAcceptancePolicyDecisionPort,
} from '../../src/workroom/acceptance-policy.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';
import { buildLegacyRunOfflineReport } from '../../src/workroom/legacy-run-offline-migration.js';
import { materializeWorkroomRemoteAssignment } from '../../src/workroom/remote-assignment-issuance.js';
import { WORKROOM_A2A_EXTENSION_URI } from '../../src/workroom/remote-dispatch.js';
import { remoteDisclosureFixture } from '../workroom/remote-disclosure-fixture.js';
import {
  createWorkroomRoleCapabilityReference,
  createWorkroomRoleCapabilitySnapshot,
  createWorkroomRoleCapabilitySupply,
} from '../../src/workroom/role-capability-snapshot.js';
import { replayWorkroomPreemptions } from '../../src/workroom/workroom-preemption.js';
import {
  createWorkroomSchedulerPolicySnapshot,
  decideWorkroomSchedule,
  proposeWorkroomPriorityChange,
} from '../../src/workroom/workroom-scheduler.js';
import { WorkflowPlanBuilder } from '../../src/workroom/workflow-plan-builder.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import type { WorkroomLocalAssignmentAuthorityPort } from '../../src/workroom/local-assignment-issuance.js';

const sha = (value: string) => `sha256:${value.repeat(64)}`;

describe('Workroom priority and preemption production composition', () => {
  it('keeps chat spawn outside Workroom Journal and physically removes it from Assignment capability', async () => {
    const journal = new MemoryWorkroomJournal();
    let spawnCalls = 0;
    const owner = rootPluginId();
    const capabilities: AgentCapabilities = Object.freeze({
      generation: 1, owner,
      tools: Object.freeze([
        hostTool(owner, 'spawn_task', async () => { spawnCalls += 1; return { queued: true }; }),
        hostTool(owner, 'read_repo', async input => input),
        hostTool(owner, 'workroom_claim_task', async input => input),
      ]),
      skills: Object.freeze([]), agents: Object.freeze([]), mcp: Object.freeze([]),
    });
    const chat = createDeferredCapabilityPlan({
      capabilities, sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['spawn_task', 'workroom_claim_task'] } },
      persistSnapshot: async () => undefined,
    });
    expect(chat.allTools.map(tool => tool.name)).toContain('spawn_task');
    const spawn = capabilities.tools.find(tool => tool.name === 'spawn_task');
    await spawn?.execute({}, invocation());
    expect(spawnCalls).toBe(1);
    expect(await journal.listRunIds()).toEqual([]);

    const authority = assignmentCapabilityAuthority(capabilities);
    const workroom = createWorkroomDeferredCapabilityPlan({
      capabilities, authority, sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
      config: { deferredTools: { alwaysLoadedTools: ['spawn_task', 'workroom_claim_task'] } },
      persistSnapshot: async () => undefined,
    });
    expect(workroom.allTools.map(tool => tool.name)).toEqual([
      'read_repo', 'discover', 'load_tool', 'load_skill',
    ]);

    // PlanBuilder receives values only; building a proposal has no Journal or Host I/O port.
    WorkflowPlanBuilder.create({
      proposalId: 'no-io-plan', projectId: 'project', parameterDigest: sha('a'),
      strategy: { id: 'strategy', version: '1', digest: sha('a') },
      authority: {
        projectRevision: sha('a'), projectDigest: sha('b'), profileRevisionId: 'profile',
        profileDigest: sha('c'), planningPolicyRevisionId: 'planning', planningPolicyDigest: sha('d'),
        orchestratorAgentDefinitionId: 'orchestrator', orchestratorAuthorityDigest: sha('e'),
      },
      budget: { maxTasks: 1, maxTotalAttempts: 2 },
      schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
        policyRef: 'no-io-scheduler', revision: 1, pinnedAtSequence: 1, capacity: 1,
        agingStepMs: 100, starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
        preemptionDeadlineMs: 100,
      }),
    }).addTask(task('only', 'normal')).build();
    expect(await journal.listRunIds()).toEqual([]);
  });

  it('joins Sponsor/Orchestrator authority to the exact Catalog revision and Project digest', async () => {
    const definition = {
      name: 'Project', sponsors: ['human:sponsor'],
      members: [{ role: 'orchestrator' as const, agent: 'agent:orchestrator' }],
    };
    const projectAuthority = {
      catalogRevision: sha('a'), projectDigest: digestCanonicalWorkroomValue(definition),
      orchestratorAgentDefinitionId: 'agent:orchestrator',
    };
    const authority = createCatalogWorkroomPriorityAuthority({
      read: async () => ({ revision: sha('a'), definitions: { project: definition } }),
    });
    const sponsorRef = workroomPriorityAuthorityReference({
      projectAuthority,
      proposal: { projectId: 'project', authority: 'sponsor', principalId: 'human:sponsor' },
    });
    const sponsor = proposeWorkroomPriorityChange({
      projectId: 'project', runId: 'run', taskKey: 'task', taskRevision: 1,
      expectedSequence: 2, currentLane: 'normal', requestedLane: 'urgent', localRank: 0,
      principalId: 'human:sponsor', authority: 'sponsor', authorityRef: sponsorRef, deadline: 1_000,
    });

    await expect(authority.authorize({
      version: 1, proposal: sponsor, projectAuthority,
      currentTask: { taskRevision: 1, sponsorLane: 'normal', localRank: 1 },
    })).resolves.toMatchObject({ authorized: true, authority: 'sponsor' });

    const orchestratorRef = workroomPriorityAuthorityReference({
      projectAuthority,
      proposal: { projectId: 'project', authority: 'orchestrator', principalId: 'agent:orchestrator' },
    });
    const orchestrator = proposeWorkroomPriorityChange({
      projectId: 'project', runId: 'run', taskKey: 'task', taskRevision: 1,
      expectedSequence: 2, currentLane: 'normal', requestedLane: 'normal', localRank: 99,
      principalId: 'agent:orchestrator', authority: 'orchestrator',
      authorityRef: orchestratorRef, deadline: 1_000,
    });
    await expect(authority.authorize({
      version: 1, proposal: orchestrator, projectAuthority,
      currentTask: { taskRevision: 1, sponsorLane: 'normal', localRank: 1 },
    })).resolves.toMatchObject({ authorized: true, authority: 'orchestrator' });
    await expect(authority.authorize({
      version: 1, proposal: sponsor,
      projectAuthority: { ...projectAuthority, catalogRevision: sha('b') },
      currentTask: { taskRevision: 1, sponsorLane: 'normal', localRank: 1 },
    })).resolves.toEqual({ authorized: false, reason: 'project_authority_stale' });
  });

  it('normalizes local and remote completion into the same non-accepting Assignment facts', async () => {
    const local = await completionFixture('local');
    const remote = await completionFixture('remote');
    for (const fixture of [local, remote]) {
      const before = await fixture.kernel.read('project', fixture.runId);
      await new AssignmentObservationIngress({ kernel: fixture.kernel }).apply(
        fixture.envelope,
        {
          version: 1, type: 'execution_completed', observationId: `${fixture.kind}:completed`,
          envelopeDigest: fixture.envelope.digest,
          completion: {
            report: { ref: `report:${fixture.kind}`, digest: sha('d') },
            candidate: { ref: `candidate:${fixture.kind}`, hash: sha('c') },
          },
        },
        before.sequence,
      );
    }
    const localEvent = (await local.journal.read(local.runId)).at(-1)!;
    const remoteEvent = (await remote.journal.read(remote.runId)).at(-1)!;
    expect(localEvent.type).toBe('assignment.execution_completed');
    expect(remoteEvent.type).toBe(localEvent.type);
    expect(Object.keys(remoteEvent.payload).sort()).toEqual(Object.keys(localEvent.payload).sort());
    expect((await local.kernel.read('project', local.runId)).tasks.task?.status)
      .toBe('awaiting_acceptance');
    expect((await remote.kernel.read('project', remote.runId)).tasks.task?.status)
      .toBe('awaiting_acceptance');
    expect((await local.journal.read(local.runId)).some(event => event.type === 'task.accepted')).toBe(false);
    expect((await remote.journal.read(remote.runId)).some(event => event.type === 'task.accepted')).toBe(false);
  });

  it('recovers a durable request, routes only to the exact local producer, and never treats delivery as ack', async () => {
    const { journal, kernel, runId, envelope, decision } = await preemptionFixture('remote');
    const requests: unknown[] = [];
    const blocked: string[] = [];
    let providerInstalled = false;
    const delivery = new WorkroomAssignmentCheckpointDelivery({
      kernel,
      resolveProvider: () => providerInstalled ? {
        request: async input => { requests.push(input); },
      } : undefined,
    });
    const controls = hostPreemptionControls(kernel, reason => { blocked.push(reason); });
    const firstGeneration = new WorkroomPreemptionRuntime({ journal, delivery, unavailableControl: controls });

    await expect(firstGeneration.drain()).resolves.toEqual({ delivered: 0, blocked: 1 });
    expect(blocked).toEqual(['provider_unavailable']);
    expect((await kernel.read('project', runId)).tasks.urgent?.blockers).toEqual([
      expect.objectContaining({
        owner: 'workroom-checkpoint-delivery', allowedActions: ['resolve', 'replan', 'cancel'],
      }),
    ]);
    expect((await kernel.read('project', runId)).assignments[envelope.assignmentId])
      .toMatchObject({ status: 'running', owner: envelope.principalId });
    await firstGeneration.dispose();

    providerInstalled = true;
    const restarted = new WorkroomPreemptionRuntime({ journal, delivery, unavailableControl: controls });
    await expect(restarted.drain()).resolves.toEqual({ delivered: 1, blocked: 0 });
    expect(requests).toEqual([expect.objectContaining({
      version: 1, transport: 'remote', envelope, remoteEndpointId: 'endpoint:remote',
      preemption: expect.objectContaining({ decisionId: decision.decisionId }),
    })]);
    expect(controls.recover).toHaveBeenCalledOnce();
    expect(replayWorkroomPreemptions(await journal.read(runId)).pending?.decisionId)
      .toBe(decision.decisionId);
    await restarted.dispose();
  });

  it('runs accepted Task to dependent next Task through the real Scheduler and local issuance chain', async () => {
    const journal = new MemoryWorkroomJournal();
    const kernel = new WorkroomKernel({
      journal, now: () => 100, acceptancePolicy: acceptancePolicy(),
      localAssignmentAuthority: localAuthority(),
    });
    const plan = WorkflowPlanBuilder.create({
      proposalId: 'chain-plan', projectId: 'project', parameterDigest: sha('a'),
      strategy: { id: 'strategy', version: '1', digest: sha('a') },
      authority: {
        projectRevision: sha('a'), projectDigest: sha('b'), profileRevisionId: 'profile',
        profileDigest: sha('c'), planningPolicyRevisionId: 'planning', planningPolicyDigest: sha('d'),
        orchestratorAgentDefinitionId: 'agent:orchestrator', orchestratorAuthorityDigest: sha('e'),
      },
      budget: { maxTasks: 4, maxTotalAttempts: 8 },
      schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
        policyRef: 'scheduler', revision: 1, pinnedAtSequence: 1, capacity: 1,
        agingStepMs: 100, starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
        preemptionDeadlineMs: 100,
      }),
    }).addTask(task('build', 'normal')).addTask({
      ...task('test', 'normal'), dependsOn: ['build'],
    }).build();
    const admitted = await kernel.admitWorkflowPlan({
      operationId: 'chain-admit', projectId: 'project', title: 'Chain', sourceEventRef: 'event:chain',
      sourceEventDigest: sha('a'), orchestratorAgentDefinitionId: 'agent:orchestrator', plan,
    });
    const dispatched: ReturnType<typeof createAssignmentExecutionEnvelope>[] = [];
    const supply = new LocalWorkroomSchedulerDispatchSupply({
      catalog: { read: async () => ({
        revision: sha('a'), definitions: {
          project: { name: 'Project', members: [{ role: 'executor', agent: 'agent:executor' }] },
        },
      }) },
      runState: {
        read: (projectId, runId) => kernel.read(projectId, runId),
        pinTaskAcceptance: (projectId, runId, taskKey) =>
          kernel.pinTaskAcceptance(projectId, runId, taskKey),
      },
      kernel,
      runtime: { dispatch: envelope => { dispatched.push(envelope); } },
      route: { resolve: async () => ({
        kind: 'local', agentDefinitionId: 'agent:executor', authorityRef: 'catalog:exact',
      }) },
    });
    const scheduler = new WorkroomSchedulerRuntime({
      journal, commands: createWorkroomSchedulerKernelCommandPort(kernel), resolveSupply: () => supply,
    });

    await expect(scheduler.drain()).resolves.toMatchObject({ scheduled: 1, delivered: 1 });
    expect(dispatched[0]?.taskKey).toBe('build');
    const local = new WorkroomLocalAssignmentRuntime({
      kernel,
      executor: {
        async *execute(envelope) {
          yield {
            version: 1, type: 'execution_completed', observationId: `completed:${envelope.taskKey}`,
            envelopeDigest: envelope.digest,
            completion: {
              report: { ref: `report:${envelope.taskKey}`, digest: sha('d') },
              candidate: { ref: 'candidate', hash: sha('c') },
            },
          };
        },
      },
    });
    await local.execute(dispatched[0]!);
    await kernel.evaluateTaskAcceptance('project', admitted.runId, 'build');

    await expect(scheduler.drain()).resolves.toMatchObject({ scheduled: 1, delivered: 1 });
    expect(dispatched.map(envelope => envelope.taskKey)).toEqual(['build', 'test']);
    expect((await kernel.read('project', admitted.runId)).tasks).toMatchObject({
      build: { status: 'accepted' }, test: { status: 'executing' },
    });
    await local.dispose();
    await scheduler.dispose();
  });

  it('aborts an in-flight checkpoint transport when its generation retires', async () => {
    const { journal, kernel } = await preemptionFixture();
    let transportSignal: AbortSignal | undefined;
    const delivery = new WorkroomAssignmentCheckpointDelivery({
      kernel,
      resolveProvider: () => ({
        request: async (_input, signal) => await new Promise<void>((_resolve, reject) => {
          transportSignal = signal;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      }),
    });
    const runtime = new WorkroomPreemptionRuntime({
      journal, delivery,
      unavailableControl: { block: async () => undefined, recover: async () => undefined },
    });

    const draining = runtime.drain();
    await vi.waitFor(() => expect(transportSignal).toBeDefined());
    await expect(runtime.dispose()).resolves.toBeUndefined();
    await expect(draining).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportSignal?.aborted).toBe(true);
  });

  it('keeps legacy completed output historical and bounds low-lane starvation under urgent traffic', async () => {
    const report = buildLegacyRunOfflineReport({
      orchestration_runs: [{
        id: 'legacy-completed', session_key: 'session:legacy', status: 'completed', title: 'Old',
        template: '', source_json: '{"kind":"manual","label":"offline"}',
        state_json: '{}', state_version: 0,
        created_at: 1, updated_at: 2,
      }],
      orchestration_tasks: [{
        id: 'legacy-task', run_id: 'legacy-completed', name: 'old', description: '', role: 'worker',
        goal: 'old', status: 'completed', depends_on: '[]', executor_kind: 'local', assigned_to: '',
        remote_agent_id: '', remote_task_id: '', priority: 'medium', context_json: '{}',
        is_writer: 0, phase: '', result_summary: 'legacy done', error: '',
        created_at: 1, updated_at: 2, started_at: 1, finished_at: 2,
      }],
      orchestration_events: [{
        id: 'legacy-event', run_id: 'legacy-completed', task_id: 'legacy-task',
        type: 'run.started', seq: 0, payload_json: '{}', created_at: 1,
      }],
    });
    expect(report.runs[0]).toMatchObject({
      migrationStatus: 'historical_only', accepted: false, allowedActions: ['export'],
    });
    expect(JSON.stringify(report)).not.toContain('task.accepted');

    const policy = createWorkroomSchedulerPolicySnapshot({
      policyRef: 'scheduler', revision: 1, pinnedAtSequence: 1, capacity: 1,
      agingStepMs: 100, starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
      preemptionDeadlineMs: 100,
    });
    const events = schedulerFacts(policy);
    expect(decideWorkroomSchedule(events)).toMatchObject({
      type: 'dispatch_task', taskKey: 'low-starved', reason: 'starvation_bound', sponsorLane: 'low',
    });
  });

  it('keeps replan available after checkpoint timeout and executes explicit cancellation', async () => {
    const { kernel, runId, envelope, decision } = await preemptionFixture();
    const timedOut = await kernel.execute('project', runId, {
      type: 'advance_clock', now: decision.deadline,
    });
    expect(timedOut.tasks.urgent?.blockers).toEqual([
      expect.objectContaining({ allowedActions: ['resolve', 'replan', 'cancel'] }),
    ]);
    const cancelling = await kernel.execute('project', runId, {
      type: 'cancel_run', reason: 'Sponsor cancelled instead of replanning',
      controlDeadline: decision.deadline + 10,
    });
    expect(cancelling).toMatchObject({
      status: 'cancelling', assignments: { [envelope.assignmentId]: { status: 'cancel_requested' } },
    });
    const cancelled = await kernel.execute('project', runId, {
      type: 'advance_clock', now: decision.deadline + 11,
    });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      assignments: { [envelope.assignmentId]: { status: 'cancelled', outcome: 'outcome_unknown' } },
    });
  });
});

async function preemptionFixture(producer: 'local' | 'remote' = 'local') {
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({ journal, now: () => 100 });
  const plan = WorkflowPlanBuilder.create({
    proposalId: 'plan', projectId: 'project', parameterDigest: sha('a'),
    strategy: { id: 'strategy', version: '1', digest: sha('a') },
    authority: {
      projectRevision: sha('a'), projectDigest: sha('b'), profileRevisionId: 'profile',
      profileDigest: sha('c'), planningPolicyRevisionId: 'planning', planningPolicyDigest: sha('d'),
      orchestratorAgentDefinitionId: 'agent:orchestrator', orchestratorAuthorityDigest: sha('e'),
    },
    budget: { maxTasks: 4, maxTotalAttempts: 8 },
    schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
      policyRef: 'scheduler', revision: 1, pinnedAtSequence: 1, capacity: 1,
      agingStepMs: 100, starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
      preemptionDeadlineMs: 100,
    }),
  }).addTask(task('background', 'low')).addTask(task('urgent', 'urgent')).build();
  const admitted = await kernel.admitWorkflowPlan({
    operationId: 'admit', projectId: 'project', title: 'Run', sourceEventRef: 'event:1',
    sourceEventDigest: sha('a'), orchestratorAgentDefinitionId: 'agent:orchestrator', plan,
  });
  const remote = producer === 'remote' ? remoteIssuance(admitted.runId, admitted.state.sequence) : undefined;
  const envelope = remote?.envelope ?? createAssignmentExecutionEnvelope({
    projectId: 'project', runId: admitted.runId, taskKey: 'background', taskRevision: 1,
    assignmentId: 'assignment:background', assignmentRevision: 1, attempt: 1, fence: 1,
    principalId: 'agent:executor', role: 'executor',
    agentDefinition: snapshot('agent'), plan: snapshot('plan'), contextPolicy: snapshot('context'),
    factAnchor: { ref: 'facts', sequence: admitted.state.sequence, digest: sha('1') },
    capabilitySnapshot: snapshot('capability'), policySnapshot: snapshot('policy'),
    workspace: { leaseRef: 'lease', mountRef: '/workspace', baseRevision: 'base', fence: 1 },
  });
  await journal.append(admitted.runId, admitted.state.sequence, [{
    eventId: 'claim', occurredAt: 100, type: 'assignment.claimed', payload: {
      taskKey: 'background', assignmentId: envelope.assignmentId, taskRevision: 1,
      assignmentRevision: 1, attempt: 1, fence: 1, envelopeDigest: envelope.digest,
      owner: envelope.principalId, role: 'executor', leaseExpiresAt: 1_000,
    },
  }, {
    eventId: 'start', occurredAt: 100, type: 'assignment.started',
    payload: { assignmentId: envelope.assignmentId },
  }, producer === 'remote' ? {
    eventId: 'remote-request', occurredAt: 100, type: 'remote_dispatch.requested',
    payload: remote as unknown as Record<string, unknown>,
  } : {
    eventId: 'local-request', occurredAt: 100, type: 'local_execution.requested', payload: {
      operationId: 'background-dispatch', requestDigest: sha('f'),
      agentDefinitionId: 'agent:executor', issuedAt: 100, envelope,
    },
  }]);
  const decision = decideWorkroomSchedule(await journal.read(admitted.runId));
  if (!decision || decision.type !== 'prepare_preemption') throw new Error('fixture needs preemption');
  await kernel.commitSchedulerDecision(decision);
  return { journal, kernel, runId: admitted.runId, envelope, decision };
}

async function completionFixture(kind: 'local' | 'remote') {
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({ journal, now: () => 100, acceptancePolicy: acceptancePolicy() });
  const runId = `${kind}-completion-run`;
  await kernel.createRun({ runId, projectId: 'project', title: `${kind} completion` });
  await kernel.execute('project', runId, {
    type: 'plan_task', taskKey: 'task', title: 'Task', required: true, maxAttempts: 2,
  });
  await kernel.pinTaskAcceptance('project', runId, 'task');
  const envelope = createAssignmentExecutionEnvelope({
    projectId: 'project', runId, taskKey: 'task', taskRevision: 1,
    assignmentId: `${kind}-assignment`, assignmentRevision: 1, attempt: 1, fence: 1,
    principalId: `agent:${kind}`, role: 'executor', agentDefinition: snapshot('agent'),
    plan: snapshot('plan'), contextPolicy: snapshot('context'),
    factAnchor: { ref: `facts:${kind}`, sequence: 2, digest: sha('b') },
    capabilitySnapshot: snapshot('capability'), policySnapshot: snapshot('policy'),
    workspace: { leaseRef: `lease:${kind}`, mountRef: '/workspace', baseRevision: 'base', fence: 1 },
  });
  await kernel.execute('project', runId, {
    type: 'claim_task', taskKey: 'task', assignmentId: envelope.assignmentId,
    assignmentRevision: 1, fence: 1, envelopeDigest: envelope.digest,
    owner: envelope.principalId, role: 'executor', leaseExpiresAt: 1_000,
  });
  await kernel.execute('project', runId, {
    type: 'start_assignment', assignmentId: envelope.assignmentId,
  });
  return { kind, journal, kernel, runId, envelope };
}

function task(key: string, sponsorLane: 'low' | 'normal' | 'urgent') {
  return {
    key, title: key, role: 'executor', required: true, maxAttempts: 2, dependsOn: [], requires: {},
    scheduler: { sponsorLane, localRank: 0, enqueuedAt: 100, deadline: 1_000, preemptibility: 'checkpointable' as const },
  };
}

function snapshot(ref: string) {
  return { ref, revision: 1, digest: sha('a') };
}

function acceptancePolicy(): WorkroomAcceptancePolicyDecisionPort {
  return {
    pinContract(input: WorkroomAcceptanceContractPinInput) {
      return {
        id: `contract:${input.task.key}`, revision: 1, digest: sha('b'),
        taskKey: input.task.key, taskRevision: input.task.revision, kind: 'task_result',
        policy: { id: 'policy', revision: 1, digest: sha('a') },
        criteria: [{ id: 'tests', kind: 'deterministic', description: 'Tests pass' }],
        requiredEvidence: [],
      };
    },
    decide(input: WorkroomAcceptanceDecisionInput) {
      return {
        version: 1, disposition: 'accepted', route: 'auto_accept',
        candidate: {
          id: input.assignment.candidateRef, taskKey: input.task.key, taskRevision: input.task.revision,
          producerAssignmentId: input.assignment.id, producerPrincipalId: input.assignment.owner,
          reportRef: input.task.reportRef, hash: input.assignment.candidateHash,
          claimIds: ['claim'], evidenceRefs: [],
        },
        contract: input.contract,
        riskAssessment: {
          id: 'risk', candidateHash: input.assignment.candidateHash, tier: 'low',
          factsHash: sha('f'), assessor: 'policy', sourceRefs: [],
        },
        checkResults: [{
          id: 'check', criterionId: 'tests', status: 'passed',
          candidateHash: input.assignment.candidateHash, runner: 'ci', runnerVersion: '1', evidenceRefs: [],
        }],
        acceptedClaimIds: ['claim'], rejectedClaimIds: [], decidedBy: 'acceptance-policy:policy',
      };
    },
  };
}

function localAuthority(): WorkroomLocalAssignmentAuthorityPort {
  return {
    resolveLocal: async input => ({
      principalId: 'agent:executor', role: 'executor', agentDefinitionId: 'agent:executor',
      agentDefinition: snapshot('agent'), plan: snapshot('plan'), contextPolicy: snapshot('context'),
      capabilitySnapshot: snapshot('capability'), policySnapshot: snapshot('policy'),
      workspace: {
        leaseRef: `lease:${input.assignment.id}`, mountRef: '/workspace',
        baseRevision: 'base', fence: input.assignment.fence,
      },
      contextView: { ref: 'context', hash: sha('a') }, capabilityGrantRef: 'grant',
    }),
  };
}

function remoteIssuance(runId: string, factSequence: number) {
  return materializeWorkroomRemoteAssignment({
    request: {
      operationId: 'background-dispatch', projectId: 'project', runId,
      taskKey: 'background', agentDefinitionId: 'agent:executor', endpointId: 'endpoint:remote',
    },
    taskRevision: 1, assignmentId: 'assignment:background', assignmentRevision: 1,
    attempt: 1, fence: 1, issuedAt: 100, leaseExpiresAt: 1_000, reconcileDeadline: 2_000,
    acceptanceContract: {
      id: 'contract:background', revision: 1, digest: sha('a'), taskKey: 'background',
      taskRevision: 1, kind: 'task_result', policy: { id: 'policy', revision: 1, digest: sha('b') },
      criteria: [], requiredEvidence: [],
    },
    factAnchor: { ref: 'facts', sequence: factSequence, digest: sha('1') },
    authority: {
      principalId: 'agent:executor', role: 'executor', agentDefinitionId: 'agent:executor',
      agentDefinition: snapshot('agent'), plan: snapshot('plan'), contextPolicy: snapshot('context'),
      capabilitySnapshot: snapshot('capability'), policySnapshot: snapshot('policy'),
      workspace: {
        leaseRef: 'lease', mountRef: '/workspace', baseRevision: '1'.repeat(40), fence: 1,
      },
      endpoint: {
        id: 'endpoint:remote', owner: 'agent:executor', cardDigest: sha('c'), authBindingId: 'auth',
        workroomExtension: WORKROOM_A2A_EXTENSION_URI, idempotentDispatch: true,
        typedCompletionEnvelope: true, workspaceProviders: ['github_pull_request'],
      },
      contextView: { ref: 'context-view', hash: sha('d') }, capabilityGrantRef: 'grant',
      disclosureManifest: remoteDisclosureFixture({
        projectId: 'project', assignmentId: 'assignment:background', endpointId: 'endpoint:remote',
        principalId: 'agent:executor', sourceRef: 'context-view', sourceDigest: sha('d'),
      }),
      remoteWorkspace: {
        provider: 'github_pull_request', repositoryId: 'github:owner/repo',
        integrationBindingId: 'github-app', baseSha: '1'.repeat(40), targetRef: 'refs/heads/main',
        branchRef: 'refs/heads/workroom/background', pathScope: ['packages/im/agent'],
        mode: 'branch_only', fence: 1,
      },
    },
  });
}

function hostPreemptionControls(
  kernel: WorkroomKernel,
  onBlock: (reason: string) => void,
): WorkroomPreemptionUnavailableControlPort {
  const block = vi.fn(async (
    preemption: Parameters<WorkroomPreemptionUnavailableControlPort['block']>[0],
    reason: string,
  ) => {
    onBlock(reason);
    const state = await kernel.read(preemption.projectId, preemption.runId);
    const blockerId = `checkpoint-delivery:${preemption.decisionId}`;
    const taskState = state.tasks[preemption.reservedTaskKey];
    if (!taskState || taskState.blockers.some(blocker => blocker.id === blockerId)) return;
    await kernel.execute(preemption.projectId, preemption.runId, {
      type: 'block_task', taskKey: preemption.reservedTaskKey, blockerId,
      kind: 'capability', owner: 'workroom-checkpoint-delivery',
      reason: `Typed Assignment checkpoint transport unavailable: ${reason}`,
      deadline: preemption.deadline,
    });
  });
  const recover = vi.fn(async (
    preemption: Parameters<WorkroomPreemptionUnavailableControlPort['recover']>[0],
  ) => {
    const state = await kernel.read(preemption.projectId, preemption.runId);
    const blockerId = `checkpoint-delivery:${preemption.decisionId}`;
    if (!state.tasks[preemption.reservedTaskKey]?.blockers.some(blocker => blocker.id === blockerId)) return;
    await kernel.execute(preemption.projectId, preemption.runId, {
      type: 'resolve_blocker', taskKey: preemption.reservedTaskKey, blockerId,
    });
  });
  return { block, recover };
}

function hostTool(
  owner: ReturnType<typeof rootPluginId>,
  name: string,
  execute: ToolCapability['execute'],
): ToolCapability {
  return Object.freeze({
    owner, name, qualifiedName: name, description: name, approval: 'never',
    source: `/agent/tools/${name}.ts`, execute,
  });
}

function invocation(): ToolInvocationContext {
  return Object.freeze({
    signal: new AbortController().signal, traceId: 'trace', turnId: 'turn', sessionKey: 'chat',
    origin: { kind: 'internal', source: 'test' },
    principal: { subjectId: 'human', roles: ['user'] },
    policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
  });
}

function assignmentCapabilityAuthority(capabilities: AgentCapabilities) {
  const scope = {
    projectId: 'project', runId: 'run', taskKey: 'task', taskRevision: 1,
    assignmentId: 'assignment', assignmentRevision: 1, role: 'executor' as const,
    capabilitySnapshotRef: 'capability:assignment:1', capabilitySnapshotRevision: 1,
  };
  const sources = ['generation', 'profile', 'agent_definition', 'role', 'task', 'policy'] as const;
  const supplies = Object.fromEntries(sources.map((source, index) => [source,
    createWorkroomRoleCapabilitySupply({
      source, id: `authority:${index}`, revision: 1, ...scope,
      tools: [{ name: 'read_repo', digest: sha('a') }], skills: [],
    }),
  ]));
  const typedSupplies = supplies as unknown as Record<typeof sources[number],
    ReturnType<typeof createWorkroomRoleCapabilitySupply>>;
  const capabilitySnapshot = createWorkroomRoleCapabilityReference(typedSupplies);
  const envelope = createAssignmentExecutionEnvelope({
    projectId: scope.projectId, runId: scope.runId, taskKey: scope.taskKey,
    taskRevision: scope.taskRevision, assignmentId: scope.assignmentId,
    assignmentRevision: scope.assignmentRevision, attempt: 1, fence: 1,
    principalId: 'agent:executor', role: 'executor', agentDefinition: snapshot('agent'),
    plan: snapshot('plan'), contextPolicy: snapshot('context'),
    factAnchor: { ref: 'facts', sequence: 1, digest: sha('b') },
    capabilitySnapshot, policySnapshot: snapshot('policy'),
    workspace: { leaseRef: 'lease', mountRef: '/workspace', baseRevision: 'base', fence: 1 },
  });
  const roleSnapshot = createWorkroomRoleCapabilitySnapshot({ envelope, ...typedSupplies });
  return Object.freeze({
    kind: 'workroom_assignment' as const, envelope, capabilitySnapshot: roleSnapshot,
    realization: bindWorkroomCapabilityRealization(capabilities, envelope, roleSnapshot),
  });
}

function schedulerFacts(
  policy: ReturnType<typeof createWorkroomSchedulerPolicySnapshot>,
): readonly WorkroomEvent[] {
  return [
    schedulerEvent(0, 'run.created', { projectId: 'project', title: 'Starvation' }),
    schedulerEvent(1, 'plan.admitted', { schedulerPolicy: policy }),
    schedulerEvent(2, 'task.planned', {
      taskKey: 'low-starved', title: 'Low', role: 'executor', required: true, maxAttempts: 1,
      sponsorLane: 'low', localRank: 0, enqueuedAt: 0, dependsOn: [], preemptibility: 'atomic',
    }),
    schedulerEvent(3, 'task.planned', {
      taskKey: 'urgent-latest', title: 'Urgent', role: 'executor', required: true, maxAttempts: 1,
      sponsorLane: 'urgent', localRank: 100, enqueuedAt: 500, dependsOn: [], preemptibility: 'atomic',
    }),
    schedulerEvent(4, 'clock.advanced', { now: 500 }),
  ];
}

function schedulerEvent(
  sequence: number,
  type: WorkroomEvent['type'],
  payload: Record<string, unknown>,
): WorkroomEvent {
  return Object.freeze({
    version: 1, eventId: `scheduler-event:${sequence}`, runId: 'starvation-run', sequence,
    occurredAt: sequence, type, payload: Object.freeze(payload),
  });
}
