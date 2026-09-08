import { describe, expect, it } from 'vitest';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import { replayWorkroom } from '../../src/workroom/kernel-state.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { createSoftwareDeliveryPlan, type SoftwareDeliveryPlanInput } from '../../src/workroom/software-delivery-plan.js';
import type { WorkroomPlanGateAuthorizationInput } from '../../src/workroom/plan-approval-control.js';
import { WorkroomSchedulerApplication, createWorkroomSchedulerKernelCommandPort } from '../../src/workroom/workroom-scheduler-application.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';
import { AssignmentObservationIngress } from '../../src/workroom/assignment-observation-ingress.js';
import { createAssignmentExecutionEnvelope, type AssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';
import type { WorkroomAcceptanceContractPinInput, WorkroomAcceptanceDecision, WorkroomAcceptanceDecisionInput } from '../../src/workroom/acceptance-policy.js';
import type { WorkroomAcceptanceAuthorizationDecision } from '../../src/workroom/acceptance-control.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const TEST_CANDIDATE_HASH = `sha256:${'c'.repeat(64)}`;
const TEST_REPORT_DIGEST = `sha256:${'d'.repeat(64)}`;
const TEST_ENVELOPES = new WeakMap<WorkroomKernel, Map<string, AssignmentExecutionEnvelope>>();

// The transports are fixture authorities; Kernel, Journal, admission, observations and
// dependency scheduling are the production implementations. No external deployment is claimed.
describe('governed software delivery acceptance', () => {
  it('holds the admitted DAG until exact acceptance, and resumes the human Gate after restart', async () => {
    let now = 100;
    let id = 0;
    const journal = new MemoryWorkroomJournal();
    const basePolicy = pinnedAcceptancePolicy();
    const options = {
      journal, now: () => now, createId: () => `delivery-${++id}`,
      acceptanceAuthority: allowingAcceptanceAuthority(),
      planGateAuthority: {
        authorize(input: WorkroomPlanGateAuthorizationInput) {
          return input.sponsorPrincipalId === 'sponsor-alice'
            ? { authorized: true as const, principalId: input.sponsorPrincipalId, authorizationRef: 'membership:release' }
            : { authorized: false as const, reason: 'Project Sponsor required' };
        },
      },
      acceptancePolicy: {
        ...basePolicy,
        decide(input: WorkroomAcceptanceDecisionInput): WorkroomAcceptanceDecision {
          const baseline = lowRiskAcceptance(input);
          if (input.task.key !== 'review') return baseline;
          return {
            ...baseline, disposition: 'policy_blocked', route: 'reviewer_then_sponsor',
            reason: 'Release requires independent review and a Project Sponsor',
            riskAssessment: { ...baseline.riskAssessment, tier: 'high' },
            wait: { owner: 'reviewer-pool', deadline: input.now + 20,
              allowedActions: ['claim', 'submit_verdict', 'reassign', 'replan', 'cancel'] },
            nextWait: { owner: 'sponsor', deadline: input.now + 40,
              allowedActions: ['approve', 'reject', 'request_changes', 'reopen', 'rebase', 'replan', 'cancel'] },
          };
        },
      },
    };
    let kernel = new WorkroomKernel(options);
    const stages = ['requirements', 'design', 'implement', 'test', 'review', 'release', 'health'];
    const plan = createSoftwareDeliveryPlan(deliveryInput());
    const { runId } = await kernel.admitWorkflowPlan({
      operationId: 'delivery-1', projectId: 'project-1', title: 'Governed repair',
      sourceEventRef: 'requirement://issue-1', sourceEventDigest: DIGEST,
      orchestratorAgentDefinitionId: 'orchestrator', plan,
    });
    const schedule = () => new WorkroomSchedulerApplication({
      journal, commands: createWorkroomSchedulerKernelCommandPort(kernel),
    }).runOnce(runId);
    for (const key of stages) {
      if (key === 'release') {
        expect(await schedule()).toMatchObject({ status: 'idle' });
        const beforeApproval = await kernel.read('project-1', runId);
        const decision = {
          operationId: 'release-approval', projectId: 'project-1', runId,
          taskKey: 'release', taskRevision: 1, gateId: 'approval:release',
          expectedSequence: beforeApproval.sequence, decision: 'approve' as const,
          reason: 'Approve release task for the fixed delivery scope',
          sponsorPrincipalId: 'sponsor-alice', sponsorAuthorityRef: 'membership:release',
        };
        await expect(kernel.decidePlanApprovalGate({ ...decision, sponsorPrincipalId: 'intruder' }))
          .rejects.toThrow('unauthorized');
        expect((await kernel.read('project-1', runId)).sequence).toBe(beforeApproval.sequence);
        await kernel.decidePlanApprovalGate(decision);
        const approvedEvents = await journal.read(runId);
        expect(() => replayWorkroom(approvedEvents.map(entry => entry.type === 'plan_gate.decided'
          ? { ...entry, occurredAt: 10_000 } : entry))).toThrow('Plan Sponsor Gate deadline has expired');

      }
      expect(await schedule()).toMatchObject({ status: 'committed', taskKey: key });
      await kernel.pinTaskAcceptance('project-1', runId, key);
      const assignmentId = `executor:${key}`;
      await claimAssignment(kernel, runId, { taskKey: key, assignmentId, owner: 'builder', leaseExpiresAt: 1_000 });
      await kernel.execute('project-1', runId, { type: 'start_assignment', assignmentId });
      await completeAssignment(kernel, runId, assignmentId, `report://${key}`);
      expect(await schedule()).toMatchObject({ status: 'idle' });
      const routed = await kernel.evaluateTaskAcceptance('project-1', runId, key);
      if (key !== 'review') continue;
      const reviewId = routed.tasks.review!.currentReviewerAssignmentId!;
      await expect(kernel.claimReviewerAssignment('project-1', runId, reviewId, 'builder'))
        .rejects.toThrow('Producer cannot review');
      await kernel.claimReviewerAssignment('project-1', runId, reviewId, 'reviewer-bob');
      const reviewed = await kernel.submitReviewerVerdict('project-1', runId, reviewId, 'reviewer-bob', {
        candidateHash: TEST_CANDIDATE_HASH,
        criteria: [{ criterionId: 'criterion-build', status: 'passed', evidenceRefs: ['review://1'] }],
        acceptedClaimIds: ['claim-1'], rejectedClaimIds: [], evidenceRefs: ['review://1'],
      });
      const gateId = reviewed.tasks.review!.currentSponsorGateId!;
      kernel = new WorkroomKernel(options);
      expect((await kernel.read('project-1', runId)).sponsorGates[gateId]?.status).toBe('open');
      expect(await schedule()).toMatchObject({ status: 'idle' });
      const before = await journal.read(runId);
      for (const [principal, candidateHash, error] of [
        ['intruder', TEST_CANDIDATE_HASH, 'Acceptance authority denied'],
        ['sponsor-alice', `sha256:${'e'.repeat(64)}`, 'stale for the current Candidate hash'],
      ]) {
        await expect(kernel.decideSponsorGate('project-1', runId, gateId, principal!, {
          candidateHash: candidateHash!, decision: 'approve', reason: 'request approval',
        })).rejects.toThrow(error);
      }
      now = 140;
      await expect(kernel.decideSponsorGate('project-1', runId, gateId, 'sponsor-alice', {
        candidateHash: TEST_CANDIDATE_HASH, decision: 'approve', reason: 'late approval',
      })).rejects.toThrow('deadline has expired');
      expect(await journal.read(runId)).toEqual(before);
      expect(await schedule()).toMatchObject({ status: 'idle' });
      // Clock expiry is now made durable and a new exact-candidate Gate is evaluated.
      await kernel.execute('project-1', runId, { type: 'advance_clock', now });
      const reopened = await kernel.evaluateTaskAcceptance('project-1', runId, 'review');
      const newReviewId = reopened.tasks.review!.currentReviewerAssignmentId!;
      await kernel.claimReviewerAssignment('project-1', runId, newReviewId, 'reviewer-bob');
      const rereviewed = await kernel.submitReviewerVerdict('project-1', runId, newReviewId, 'reviewer-bob', {
        candidateHash: TEST_CANDIDATE_HASH,
        criteria: [{ criterionId: 'criterion-build', status: 'passed', evidenceRefs: ['review://2'] }],
        acceptedClaimIds: ['claim-1'], rejectedClaimIds: [], evidenceRefs: ['review://2'],
      });
      const newGateId = rereviewed.tasks.review!.currentSponsorGateId!;
      expect(newGateId).not.toBe(gateId);
      await expect(kernel.decideSponsorGate('project-1', runId, gateId, 'sponsor-alice', {
        candidateHash: TEST_CANDIDATE_HASH, decision: 'approve', reason: 'old Gate',
      })).rejects.toThrow('Open Sponsor Gate');
      await kernel.decideSponsorGate('project-1', runId, newGateId, 'sponsor-alice', {
        candidateHash: TEST_CANDIDATE_HASH, decision: 'approve', reason: 'approved exact reviewed candidate',
      });
    }
    const final = await kernel.read('project-1', runId);
    expect(final.status).toBe('completed');
    expect(Object.values(final.tasks).every(task => task.status === 'accepted')).toBe(true);
    const dispatches = (await journal.read(runId)).filter(event => event.type === 'scheduler.dispatch_requested');
    expect(dispatches.map(event => event.payload.taskKey)).toEqual(stages);
  });
});

async function claimAssignment(
  kernel: WorkroomKernel,
  runId: string,
  input: Readonly<{
    taskKey: string;
    assignmentId: string;
    owner: string;
    leaseExpiresAt: number;
    fence?: number;
  }>,
) {
  const state = await kernel.read('project-1', runId);
  const task = state.tasks[input.taskKey];
  if (!task) throw new Error(`Task ${input.taskKey} not found`);
  const attempt = task.attempt + 1;
  const fence = input.fence ?? attempt;
  const envelope = createAssignmentExecutionEnvelope({
    projectId: state.projectId,
    runId: state.runId,
    taskKey: task.key,
    taskRevision: task.revision,
    assignmentId: input.assignmentId,
    assignmentRevision: 1,
    attempt,
    fence,
    principalId: input.owner,
    role: 'executor',
    agentDefinition: {
      ref: 'agent-definition:test:1', revision: 1, digest: `sha256:${'1'.repeat(64)}`,
    },
    plan: { ref: 'workflow-plan:test:1', revision: 1, digest: `sha256:${'2'.repeat(64)}` },
    contextPolicy: { ref: 'context-policy:test:1', revision: 1, digest: `sha256:${'3'.repeat(64)}` },
    factAnchor: {
      ref: `workroom-facts:${state.runId}:${state.sequence}`,
      sequence: state.sequence,
      digest: `sha256:${'4'.repeat(64)}`,
    },
    capabilitySnapshot: { ref: 'capability:test:1', revision: 1, digest: `sha256:${'5'.repeat(64)}` },
    policySnapshot: { ref: 'policy:test:1', revision: 1, digest: `sha256:${'6'.repeat(64)}` },
    workspace: {
      leaseRef: `workspace-lease:${input.assignmentId}:${attempt}`,
      mountRef: `workspace-mount:${input.assignmentId}:${attempt}`,
      baseRevision: 'base-sha-test',
      fence,
    },
  });
  let envelopes = TEST_ENVELOPES.get(kernel);
  if (!envelopes) {
    envelopes = new Map();
    TEST_ENVELOPES.set(kernel, envelopes);
  }
  envelopes.set(input.assignmentId, envelope);
  return kernel.execute(state.projectId, state.runId, {
    type: 'claim_task',
    taskKey: input.taskKey,
    assignmentId: input.assignmentId,
    assignmentRevision: envelope.assignmentRevision,
    fence: envelope.fence,
    envelopeDigest: envelope.digest,
    owner: input.owner,
    role: 'executor',
    leaseExpiresAt: input.leaseExpiresAt,
  });
}

async function completeAssignment(
  kernel: WorkroomKernel,
  runId: string,
  assignmentId: string,
  reportRef: string,
) {
  const envelope = TEST_ENVELOPES.get(kernel)?.get(assignmentId);
  if (!envelope) throw new Error(`Execution Envelope ${assignmentId} not found`);
  const state = await kernel.read(envelope.projectId, runId);
  return new AssignmentObservationIngress({ kernel }).apply(envelope, {
    version: 1,
    type: 'execution_completed',
    observationId: `${assignmentId}:execution-completed`,
    envelopeDigest: envelope.digest,
    completion: {
      report: { ref: reportRef, digest: TEST_REPORT_DIGEST },
      candidate: { ref: 'candidate-1', hash: TEST_CANDIDATE_HASH },
    },
  }, state.sequence);
}

function lowRiskAcceptance(input: WorkroomAcceptanceDecisionInput): WorkroomAcceptanceDecision {
  return Object.freeze({
    version: 1,
    disposition: 'accepted',
    route: 'auto_accept',
    candidate: Object.freeze({
      id: 'candidate-1',
      taskKey: input.task.key,
      taskRevision: input.task.revision,
      producerAssignmentId: input.assignment.id,
      producerPrincipalId: input.assignment.owner,
      reportRef: input.task.reportRef,
      hash: TEST_CANDIDATE_HASH,
      claimIds: Object.freeze(['claim-1']),
      evidenceRefs: Object.freeze(['evidence://1']),
    }),
    contract: input.contract,
    riskAssessment: Object.freeze({
      id: 'risk-1',
      candidateHash: TEST_CANDIDATE_HASH,
      tier: 'low',
      factsHash: 'sha256:risk-facts-1',
      assessor: 'kernel-risk-engine',
      sourceRefs: Object.freeze(['plan://build', 'capability://read-only']),
    }),
    checkResults: Object.freeze([{
      id: 'check-1',
      criterionId: 'criterion-build',
      status: 'passed',
      candidateHash: TEST_CANDIDATE_HASH,
      runner: 'ci',
      runnerVersion: 'ci@1',
      evidenceRefs: Object.freeze(['evidence://1']),
    }]),
    acceptedClaimIds: Object.freeze(['claim-1']),
    rejectedClaimIds: Object.freeze([]),
    decidedBy: 'acceptance-policy:policy-1',
  });
}

function pinnedAcceptancePolicy() {
  return {
    pinContract(input: WorkroomAcceptanceContractPinInput) {
      return Object.freeze({
        id: `contract:${input.task.key}:${input.task.revision}`,
        revision: input.task.revision,
        digest: `sha256:contract-${input.task.key}-${input.task.revision}`,
        taskKey: input.task.key,
        taskRevision: input.task.revision,
        kind: 'task_result' as const,
        policy: Object.freeze({ id: 'policy-1', revision: 1, digest: 'sha256:policy-1' }),
        criteria: Object.freeze([{
          id: 'criterion-build', kind: 'deterministic' as const, description: 'Build succeeds',
        }]),
        requiredEvidence: Object.freeze(['evidence://1']),
      });
    },
    decide(input: WorkroomAcceptanceDecisionInput) {
      return lowRiskAcceptance(input);
    },
  };
}

function allowingAcceptanceAuthority(
  capture?: (decision: Record<string, unknown>) => void,
) {
  return {
    authorize(input: {
      action: 'claim_review' | 'submit_review' | 'decide_sponsor';
      principalId: string;
      requiredRole: 'reviewer' | 'sponsor';
      projectId: string;
      runId: string;
      taskKey: string;
      targetId: string;
      expectedSequence: number;
    }) {
      if (input.principalId === 'intruder') {
        return Object.freeze({
          ...input,
          authorized: false as const,
          role: input.requiredRole,
          reason: 'principal is not a Project Reviewer or Sponsor',
        });
      }
      const decision: Record<string, unknown> = {
        ...input,
        authorized: true as const,
        role: input.requiredRole,
        authorizedBy: 'project-membership:v1',
      };
      capture?.(decision);
      return decision as unknown as WorkroomAcceptanceAuthorizationDecision;
    },
  };
}

function deliveryInput(): SoftwareDeliveryPlanInput {
  const binding = { role: 'executor', requires: {}, maxAttempts: 1 };
  return {
    metadata: {
      proposalId: 'software-change', projectId: 'project-1',
      authority: {
        projectRevision: 'catalog-1', projectDigest: DIGEST,
        profileRevisionId: 'profile-1', profileDigest: DIGEST,
        planningPolicyRevisionId: 'planning-1', planningPolicyDigest: DIGEST,
        orchestratorAgentDefinitionId: 'orchestrator', orchestratorAuthorityDigest: DIGEST,
      },
      budget: { maxTasks: 7, maxTotalAttempts: 7 },
      schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
        policyRef: 'scheduler:delivery', revision: 1, pinnedAtSequence: 1,
        capacity: 1, agingStepMs: 1_000,
        starvationBoundMs: { urgent: 10_000, high: 20_000, normal: 30_000, low: 40_000 },
        preemptionDeadlineMs: 5_000,
      }),
    },
    request: { ref: 'requirement://issue-1', digest: DIGEST },
    acceptanceCriteria: [{ ref: 'criteria://test-passes', digest: DIGEST }],
    repositoryId: 'repo-1', environment: 'staging',
    sponsor: { principalId: 'sponsor-alice', decisionTimeoutMs: 1_000 },
    scheduler: { sponsorLane: 'normal', enqueuedAt: 100, deadline: 10_000 },
    stages: {
      requirements: binding, design: binding, implement: binding, test: binding,
      review: { ...binding, role: 'reviewer' }, release: binding, health: binding,
    },
  };
}

describe('software delivery plan scope', () => {
  it('bounds the Sponsor gate by its decision timeout and the task deadline', () => {
    const input = deliveryInput();
    const plan = createSoftwareDeliveryPlan(input);
    expect(plan.tasks.find(task => task.key === 'release')?.approvalGate?.deadline).toBe(1100);
    const tighter = createSoftwareDeliveryPlan({ ...input, scheduler: { ...input.scheduler, deadline: 500 } });
    expect(tighter.tasks.find(task => task.key === 'release')?.approvalGate?.deadline).toBe(500);
  });

  it('binds immutable request, acceptance criteria, repository and target environment', () => {
    const input = deliveryInput();
    const baseline = createSoftwareDeliveryPlan(input);
    for (const changed of [
      { ...input, request: { ...input.request, digest: TEST_REPORT_DIGEST } },
      { ...input, acceptanceCriteria: [{ ref: 'criteria://different', digest: DIGEST }] },
      { ...input, repositoryId: 'repo-2' },
      { ...input, environment: 'production' },
    ]) {
      const proposal = createSoftwareDeliveryPlan(changed);
      expect(proposal.parameterDigest).not.toBe(baseline.parameterDigest);
      expect(proposal.digest).not.toBe(baseline.digest);
    }
  });

  it('requires a distinct review role and immutable acceptance references', () => {
    const input = deliveryInput();
    expect(() => createSoftwareDeliveryPlan({ ...input, stages: {
      ...input.stages, review: input.stages.implement,
    } })).toThrow('separate implementation and review roles');
    expect(() => createSoftwareDeliveryPlan({ ...input, acceptanceCriteria: [] }))
      .toThrow('requires acceptance criteria');
    expect(() => createSoftwareDeliveryPlan({ ...input, request: { ref: 'issue://1', digest: 'latest' } }))
      .toThrow('immutable evidence references');
  });
});

describe('release Plan Sponsor Gate time authority', () => {
  it.each(['wall-clock', 'authorization-delay', 'persisted-timeout'] as const)(
    'rejects %s expiry without appending an approval', async (mode) => {
      let now = 100;
      let id = 0;
      const journal = new MemoryWorkroomJournal();
      const kernel = new WorkroomKernel({
        journal, now: () => now, createId: () => `plan-expiry-${++id}`,
        planGateAuthority: {
          authorize(input) {
            if (mode === 'authorization-delay') now = 10_000;
            return { authorized: true, principalId: input.sponsorPrincipalId, authorizationRef: 'membership:release' };
          },
        },
      });
      const { runId } = await kernel.admitWorkflowPlan({
        operationId: 'expired-release', projectId: 'project-1', title: 'Release gate',
        sourceEventRef: 'requirement://issue-1', sourceEventDigest: DIGEST,
        orchestratorAgentDefinitionId: 'orchestrator', plan: createSoftwareDeliveryPlan(deliveryInput()),
      });
      if (mode !== 'authorization-delay') now = 10_000;
      if (mode === 'persisted-timeout') {
        const expired = await kernel.execute('project-1', runId, { type: 'advance_clock', now });
        expect(expired.now).toBe(10_000);
        expect(expired.tasks.release?.blockers[0]?.deadline).toBeLessThanOrEqual(expired.now);
      }
      const before = await journal.read(runId);
      await expect(kernel.decidePlanApprovalGate({
        operationId: 'expired-approval', projectId: 'project-1', runId,
        taskKey: 'release', taskRevision: 1, gateId: 'approval:release',
        expectedSequence: before.length - 1, decision: 'approve', reason: 'late',
        sponsorPrincipalId: 'sponsor-alice', sponsorAuthorityRef: 'membership:release',
      })).rejects.toThrow('Plan Sponsor Gate deadline has expired');
      expect(await journal.read(runId)).toEqual(before);
    },
  );
});
