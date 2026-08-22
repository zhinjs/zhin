import { describe, expect, it, vi } from 'vitest';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  createWorkflowPlanRevisionCandidate,
} from '../../src/workroom/plan-revision.js';
import type { WorkroomPriorityAuthorityPort } from '../../src/workroom/scheduler-priority-control.js';
import {
  createWorkroomSchedulerPolicySnapshot,
  proposeWorkroomPriorityChange,
} from '../../src/workroom/workroom-scheduler.js';
import { WorkflowPlanBuilder, type WorkflowPlanProposal } from '../../src/workroom/workflow-plan-builder.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('Workroom Plan Revision Kernel admission', () => {
  it('CAS-admits a dynamic subtask after recomputing the complete diff', async () => {
    const { journal, kernel, plan, runId } = await fixture();
    const nextPlan = addTask(plan, 'review', ['build']);
    const candidate = createWorkflowPlanRevisionCandidate({
      proposalId: 'revision-2', projectId: 'project-1', runId,
      expectedSequence: 2, basePlanRevision: 1, basePlanDigest: plan.digest,
      baseTaskRevisions: { build: 1 },
      provenance: { sourceRef: 'conversation://event/2', sourceDigest: DIGEST },
      reason: 'User requested a review step', basePlan: plan, nextPlan,
    });

    const receipt = await kernel.admitPlanRevision(candidate);

    expect(receipt).toMatchObject({ status: 'applied', planRevision: 2 });
    expect(receipt.state.tasks.review).toMatchObject({ status: 'ready', revision: 1 });
    expect((await journal.read(runId)).slice(-2).map(event => event.type))
      .toEqual(['plan.revision_applied', 'task.planned']);
  });

  it('returns stale without writes when Journal sequence or base Plan changed', async () => {
    const { journal, kernel, plan, runId } = await fixture();
    const candidate = createWorkflowPlanRevisionCandidate({
      proposalId: 'revision-stale', projectId: 'project-1', runId,
      expectedSequence: 1, basePlanRevision: 1, basePlanDigest: plan.digest,
      baseTaskRevisions: { build: 1 },
      provenance: { sourceRef: 'conversation://event/2', sourceDigest: DIGEST },
      reason: 'Late proposal', basePlan: plan, nextPlan: addTask(plan, 'review', ['build']),
    });
    const before = await journal.read(runId);

    await expect(kernel.admitPlanRevision(candidate)).resolves.toMatchObject({
      status: 'stale', actualSequence: 2, planRevision: 1,
    });
    expect(await journal.read(runId)).toEqual(before);
  });

  it('returns preemption_required and writes nothing for an executing Task replacement', async () => {
    const { journal, kernel, plan, runId } = await fixture();
    await journal.append(runId, 2, [{
      eventId: 'assignment-claimed-1', occurredAt: 100, type: 'assignment.claimed',
      payload: {
        taskKey: 'build', assignmentId: 'assignment-1', taskRevision: 1, attempt: 1,
        assignmentRevision: 1, fence: 1, envelopeDigest: DIGEST,
        owner: 'executor-1', role: 'executor', leaseExpiresAt: 1_000,
      },
    }]);
    const events = await journal.read(runId);
    const nextPlan = replaceTask(plan, 'build', 'Build revised');
    const candidate = createWorkflowPlanRevisionCandidate({
      proposalId: 'revision-running', projectId: 'project-1', runId,
      expectedSequence: events.at(-1)!.sequence, basePlanRevision: 1, basePlanDigest: plan.digest,
      baseTaskRevisions: { build: 1 },
      provenance: { sourceRef: 'conversation://event/3', sourceDigest: DIGEST },
      reason: 'Change a running task', basePlan: plan, nextPlan,
    });

    await expect(kernel.admitPlanRevision(candidate)).resolves.toMatchObject({
      status: 'preemption_required', taskKeys: ['build'],
    });
    expect(await journal.read(runId)).toEqual(events);
  });

  it('atomically replaces a failed Task at its exact revision', async () => {
    const { journal, kernel, plan, runId } = await fixture();
    await journal.append(runId, 2, [{
      eventId: 'task-failed-1', occurredAt: 100, type: 'task.failed',
      payload: { taskKey: 'build', reason: 'First approach failed' },
    }]);
    const candidate = createWorkflowPlanRevisionCandidate({
      proposalId: 'revision-failed', projectId: 'project-1', runId,
      expectedSequence: 3, basePlanRevision: 1, basePlanDigest: plan.digest,
      baseTaskRevisions: { build: 1 },
      provenance: { sourceRef: 'conversation://event/failed', sourceDigest: DIGEST },
      reason: 'Use the fallback implementation', basePlan: plan,
      nextPlan: replaceTask(plan, 'build', 'Build with fallback'),
    });

    const receipt = await kernel.admitPlanRevision(candidate);

    expect(receipt).toMatchObject({
      status: 'applied', planRevision: 2,
      state: { tasks: { build: { title: 'Build with fallback', status: 'ready', revision: 2 } } },
    });
    expect((await journal.read(runId)).slice(-2).map(event => event.type))
      .toEqual(['plan.revision_applied', 'task.plan_revised']);
  });

  it('rejects a canonically re-signed but incomplete claimed diff without writes', async () => {
    const { journal, kernel, plan, runId } = await fixture();
    const candidate = createWorkflowPlanRevisionCandidate({
      proposalId: 'revision-forged-diff', projectId: 'project-1', runId,
      expectedSequence: 2, basePlanRevision: 1, basePlanDigest: plan.digest,
      baseTaskRevisions: { build: 1 },
      provenance: { sourceRef: 'conversation://event/4', sourceDigest: DIGEST },
      reason: 'Add review', basePlan: plan, nextPlan: addTask(plan, 'review', ['build']),
    });
    const body = structuredClone(candidate) as Record<string, unknown>;
    delete body.digest;
    body.diff = { added: [], replaced: [], removed: [] };
    const forged = ({ ...body, digest: digestCanonicalWorkroomValue(body) } as unknown) as typeof candidate;
    const before = await journal.read(runId);

    await expect(kernel.admitPlanRevision(forged)).resolves.toMatchObject({
      status: 'rejected', reason: expect.stringContaining('Kernel recomputation'),
    });
    expect(await journal.read(runId)).toEqual(before);
  });

  it('commits Sponsor cross-lane priority only after exact trusted authority verification', async () => {
    const authorize = vi.fn<WorkroomPriorityAuthorityPort['authorize']>(input => ({
      authorized: true, authority: 'sponsor', principalId: 'sponsor-1',
      authorizationRef: 'sponsor-authority://decision/1', proposalDigest: input.proposal.digest,
    }));
    const { journal, kernel, runId } = await fixture({ authorize });
    const events = await journal.read(runId);
    const proposal = proposeWorkroomPriorityChange({
      projectId: 'project-1', runId, taskKey: 'build', taskRevision: 1,
      expectedSequence: events.at(-1)!.sequence, currentLane: 'normal', requestedLane: 'urgent',
      localRank: 99, principalId: 'sponsor-1', authority: 'sponsor',
      authorityRef: 'sponsor-authority://decision/1', deadline: 1_000,
    });

    await expect(kernel.commitPriorityChange(proposal)).resolves.toMatchObject({ status: 'committed' });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      currentTask: expect.objectContaining({ taskRevision: 1, sponsorLane: 'normal' }),
      proposal,
    }));
    expect((await journal.read(runId)).at(-1)).toMatchObject({
      type: 'scheduler.priority_changed', payload: { requestedLane: 'urgent', authorizedBy: 'sponsor-authority://decision/1' },
    });
  });

  it('does not write priority when the trusted authority proof is not an exact echo', async () => {
    const priorityAuthority: WorkroomPriorityAuthorityPort = {
      authorize: input => ({
        authorized: true, authority: 'sponsor', principalId: 'another-sponsor',
        authorizationRef: 'sponsor-authority://decision/1', proposalDigest: input.proposal.digest,
      }),
    };
    const { journal, kernel, runId } = await fixture(priorityAuthority);
    const before = await journal.read(runId);
    const proposal = proposeWorkroomPriorityChange({
      projectId: 'project-1', runId, taskKey: 'build', taskRevision: 1,
      expectedSequence: 2, currentLane: 'normal', requestedLane: 'urgent', localRank: 99,
      principalId: 'sponsor-1', authority: 'sponsor',
      authorityRef: 'sponsor-authority://decision/1', deadline: 1_000,
    });

    await expect(kernel.commitPriorityChange(proposal)).rejects.toThrow('mismatched exact proof');
    expect(await journal.read(runId)).toEqual(before);
  });
});

async function fixture(priorityAuthority?: WorkroomPriorityAuthorityPort) {
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({ journal, now: () => 100, priorityAuthority });
  const plan = initialPlan();
  const admitted = await kernel.admitWorkflowPlan({
    operationId: 'operation-1', projectId: 'project-1', title: 'Run',
    sourceEventRef: 'conversation://event/1', sourceEventDigest: DIGEST,
    orchestratorAgentDefinitionId: 'orchestrator-1', plan,
  });
  return { journal, kernel, plan, runId: admitted.runId };
}

function initialPlan(): WorkflowPlanProposal {
  return builder('proposal-1').addTask(task('build')).build();
}

function addTask(plan: WorkflowPlanProposal, key: string, dependsOn: readonly string[]): WorkflowPlanProposal {
  let next = builder(`${plan.proposalId}-next`);
  for (const item of plan.tasks) next = next.addTask(item);
  return next.addTask(task(key, dependsOn)).build();
}

function replaceTask(plan: WorkflowPlanProposal, key: string, title: string): WorkflowPlanProposal {
  let next = builder(`${plan.proposalId}-next`);
  for (const item of plan.tasks) next = next.addTask(item.key === key ? { ...item, title } : item);
  return next.build();
}

function builder(proposalId: string) {
  return WorkflowPlanBuilder.create({
    proposalId, projectId: 'project-1', parameterDigest: DIGEST,
    strategy: { id: 'strategy:test', version: '1', digest: DIGEST },
    authority: {
      projectRevision: 'project-revision-1', projectDigest: DIGEST,
      profileRevisionId: 'profile-1', profileDigest: DIGEST,
      planningPolicyRevisionId: 'planning-policy-1', planningPolicyDigest: DIGEST,
      orchestratorAgentDefinitionId: 'orchestrator-1', orchestratorAuthorityDigest: DIGEST,
    },
    budget: { maxTasks: 8, maxTotalAttempts: 8 },
    schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
      policyRef: 'scheduler-policy:1', revision: 1, pinnedAtSequence: 1, capacity: 2,
      agingStepMs: 1_000, starvationBoundMs: { urgent: 1_000, high: 2_000, normal: 3_000, low: 4_000 },
      preemptionDeadlineMs: 1_000,
    }),
  });
}

function task(key: string, dependsOn: readonly string[] = []) {
  return {
    key, title: key === 'build' ? 'Build' : 'Review', role: 'executor', required: true,
    maxAttempts: 1, dependsOn, requires: {},
    scheduler: { sponsorLane: 'normal' as const, localRank: 10, enqueuedAt: 100,
      deadline: 1_000, preemptibility: 'checkpointable' as const },
  };
}
