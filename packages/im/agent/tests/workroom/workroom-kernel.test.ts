import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ActivatableWorkroomJournal,
  DatabaseWorkroomJournal,
  FileWorkroomJournal,
  MemoryWorkroomJournal,
  WorkroomSequenceConflictError,
} from '../../src/workroom/journal.js';
import type {
  WorkroomAcceptanceContractPinInput,
  WorkroomAcceptanceDecision,
  WorkroomAcceptanceDecisionInput,
  WorkroomAcceptancePolicyDecisionPort,
} from '../../src/workroom/acceptance-policy.js';
import type { WorkroomCommand } from '../../src/workroom/kernel-contracts.js';
import type { WorkroomAcceptanceAuthorizationDecision } from '../../src/workroom/acceptance-control.js';
import { AssignmentObservationIngress } from '../../src/workroom/assignment-observation-ingress.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
} from '../../src/workroom/assignment-executor.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { replayWorkroom } from '../../src/workroom/kernel-state.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';

const TEST_CANDIDATE_HASH = `sha256:${'c'.repeat(64)}`;
const TEST_REPORT_DIGEST = `sha256:${'d'.repeat(64)}`;
const TEST_ENVELOPES = new WeakMap<WorkroomKernel, Map<string, AssignmentExecutionEnvelope>>();

function fixture(
  acceptancePolicy: WorkroomAcceptancePolicyDecisionPort | null = pinnedAcceptancePolicy(),
) {
  let now = 100;
  let id = 0;
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({
    journal,
    now: () => now,
    createId: () => `id-${++id}`,
    acceptancePolicy: acceptancePolicy ?? undefined,
  });
  return { journal, kernel, setNow: (value: number) => { now = value; } };
}

describe('WorkroomKernel', () => {
  it('requires a pinned Acceptance Contract before an Executor can claim a Task', async () => {
    const { journal, kernel } = fixture(pinnedAcceptancePolicy());
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Pinned acceptance' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 1,
    });

    await expect(claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 200,
    })).rejects.toThrow('Acceptance Contract is not pinned');

    const pinned = await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
    expect(pinned.tasks.build?.acceptanceContract).toMatchObject({
      id: 'contract:build:1',
      taskKey: 'build',
      taskRevision: 1,
      policy: { id: 'policy-1', revision: 1, digest: 'sha256:policy-1' },
    });
    expect((await journal.read('run-1')).at(-1)?.type).toBe('task.acceptance_pinned');

    await expect(claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 200,
    })).resolves.toMatchObject({ tasks: { build: { status: 'executing' } } });
  });

  it('lets only the trusted policy port accept a low-risk mechanical candidate', async () => {
    let evaluated: WorkroomAcceptanceDecisionInput | undefined;
    const acceptancePolicy: WorkroomAcceptancePolicyDecisionPort = {
      ...pinnedAcceptancePolicy(),
      decide(input) {
        evaluated = input;
        return lowRiskAcceptance(input);
      },
    };
    const { journal, kernel } = fixture(acceptancePolicy);
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Ship release' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 2,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
    await claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    const awaiting = await completeAssignment(kernel, 'assignment-1', 'report://1');

    expect(awaiting.status).toBe('active');
    expect(awaiting.tasks.build?.status).toBe('awaiting_acceptance');

    const accepted = await kernel.evaluateTaskAcceptance('project-1', 'run-1', 'build');
    expect(accepted.tasks.build?.status).toBe('accepted');
    expect(accepted.status).toBe('completed');
    expect(evaluated).toMatchObject({
      projectId: 'project-1',
      runId: 'run-1',
      expectedSequence: 5,
      task: { key: 'build', revision: 1, reportRef: 'report://1' },
      assignment: { id: 'assignment-1', owner: 'builder', reportRef: 'report://1' },
    });
    expect((await journal.read('run-1')).at(-1)).toMatchObject({
      type: 'task.accepted',
      payload: {
        taskKey: 'build',
        reportRef: 'report://1',
        record: {
          candidateHash: TEST_CANDIDATE_HASH,
          sourceSequence: 5,
          acceptanceSequence: 6,
          policy: { id: 'policy-1', revision: 1, digest: 'sha256:policy-1' },
          acceptedClaimIds: ['claim-1'],
          decidedBy: 'acceptance-policy:policy-1',
        },
      },
    });
  });

  it('fails closed when no trusted acceptance policy is installed', async () => {
    const { kernel } = fixture(null);
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Ship release' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 1,
    });
    await expect(kernel.pinTaskAcceptance('project-1', 'run-1', 'build'))
      .rejects.toThrow('Acceptance Policy Decision Port is not installed');
    expect((await kernel.read('project-1', 'run-1')).tasks.build?.status).toBe('ready');
  });

  it('rejects an unsafe automatic-acceptance recommendation from the policy port', async () => {
    const acceptancePolicy: WorkroomAcceptancePolicyDecisionPort = {
      ...pinnedAcceptancePolicy(),
      decide(input) {
        const baseline = lowRiskAcceptance(input);
        return {
          ...baseline,
          riskAssessment: { ...baseline.riskAssessment, tier: 'high' },
        };
      },
    };
    const { journal, kernel } = fixture(acceptancePolicy);
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Deploy' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'deploy', title: 'Deploy', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'deploy');
    await claimAssignment(kernel, {
      taskKey: 'deploy', assignmentId: 'assignment-1', owner: 'deployer', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(kernel, 'assignment-1', 'report://1');

    await expect(kernel.evaluateTaskAcceptance('project-1', 'run-1', 'deploy'))
      .rejects.toThrow('Only low-risk candidates may use automatic acceptance');
    expect((await journal.read('run-1')).map(event => event.type)).not.toContain('task.accepted');
    expect((await kernel.read('project-1', 'run-1')).tasks.deploy?.status).toBe('awaiting_acceptance');
  });

  it('rejects a decision made against a different Contract or Policy snapshot', async () => {
    const acceptancePolicy: WorkroomAcceptancePolicyDecisionPort = {
      ...pinnedAcceptancePolicy(),
      decide(input) {
        const baseline = lowRiskAcceptance(input);
        return {
          ...baseline,
          contract: {
            ...baseline.contract,
            policy: { ...baseline.contract.policy, revision: 2, digest: 'sha256:policy-2' },
          },
        };
      },
    };
    const { journal, kernel } = fixture(acceptancePolicy);
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Pinned policy' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
    await claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(kernel, 'assignment-1', 'report://1');

    await expect(kernel.evaluateTaskAcceptance('project-1', 'run-1', 'build'))
      .rejects.toThrow('does not match the pinned Contract and Policy snapshot');
    expect((await journal.read('run-1')).map(event => event.type)).not.toContain('task.accepted');
    expect((await kernel.read('project-1', 'run-1')).tasks.build?.status).toBe('awaiting_acceptance');
  });

  it('creates a durable Reviewer Assignment only when policy requires one and recovers after expiry', async () => {
    let tryBypass = false;
    const acceptancePolicy: WorkroomAcceptancePolicyDecisionPort = {
      ...pinnedAcceptancePolicy(),
      decide(input) {
        const baseline = lowRiskAcceptance(input);
        if (tryBypass) return baseline;
        return {
          ...baseline,
          disposition: 'policy_blocked' as const,
          route: 'reviewer_required' as const,
          reason: 'Independent judgment is required',
          riskAssessment: { ...baseline.riskAssessment, tier: 'medium' as const },
          wait: {
            owner: 'reviewer-pool:default',
            deadline: input.now + 10,
            allowedActions: ['claim', 'submit_verdict', 'reassign', 'replan', 'cancel'] as const,
          },
        };
      },
    };
    const { journal, kernel } = fixture(acceptancePolicy);
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Review route' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
    await claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(kernel, 'assignment-1', 'report://1');

    const routed = await kernel.evaluateTaskAcceptance('project-1', 'run-1', 'build');
    const first = Object.values(routed.reviewerAssignments)[0];
    expect(first).toMatchObject({
      taskKey: 'build', candidateHash: TEST_CANDIDATE_HASH, producerPrincipalId: 'builder',
      owner: 'reviewer-pool:default', deadline: 110, status: 'open',
    });
    expect(Object.keys(routed.sponsorGates)).toHaveLength(0);
    expect((await journal.read('run-1')).at(-1)?.type).toBe('reviewer.assigned');

    const expired = await kernel.execute('project-1', 'run-1', { type: 'advance_clock', now: 111 });
    expect(expired.reviewerAssignments[first!.id]?.status).toBe('expired');
    expect(expired.status).toBe('blocked');

    tryBypass = true;
    await expect(kernel.evaluateTaskAcceptance('project-1', 'run-1', 'build'))
      .rejects.toThrow('cannot bypass an expired Acceptance wait');
    tryBypass = false;
    const reopened = await kernel.evaluateTaskAcceptance('project-1', 'run-1', 'build');
    expect(Object.values(reopened.reviewerAssignments).filter(item => item.status === 'open')).toHaveLength(1);
    expect(Object.keys(reopened.reviewerAssignments)).toHaveLength(2);
    const current = reopened.reviewerAssignments[reopened.tasks.build!.currentReviewerAssignmentId!];
    const rework = await kernel.execute('project-1', 'run-1', {
      type: 'request_rework', taskKey: 'build', reason: 'Reviewer requested a new revision',
    });
    expect(rework.reviewerAssignments[current!.id]?.status).toBe('cancelled');
    expect(rework.tasks.build).toMatchObject({ status: 'ready', revision: 2 });
    expect(rework.tasks.build?.acceptanceContract).toBeUndefined();
  });

  it('accepts a medium-risk Task only after an independently authorized Reviewer verdict', async () => {
    const journal = new MemoryWorkroomJournal();
    let lastAuthorityDecision: Record<string, unknown> | undefined;
    const kernel = new WorkroomKernel({
      journal,
      now: () => 100,
      createId: (() => { let id = 0; return () => `review-id-${++id}`; })(),
      acceptancePolicy: {
        ...pinnedAcceptancePolicy(),
        decide(input) {
          const baseline = lowRiskAcceptance(input);
          return {
            ...baseline,
            disposition: 'policy_blocked' as const,
            route: 'reviewer_required' as const,
            reason: 'Independent judgment is required',
            riskAssessment: { ...baseline.riskAssessment, tier: 'medium' as const },
            wait: {
              owner: 'reviewer-pool:default', deadline: input.now + 20,
              allowedActions: ['claim', 'submit_verdict', 'reassign', 'replan', 'cancel'] as const,
            },
          };
        },
      },
      acceptanceAuthority: allowingAcceptanceAuthority((decision) => { lastAuthorityDecision = decision; }),
    });
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Reviewed result' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
    await claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(kernel, 'assignment-1', 'report://1');
    const routed = await kernel.evaluateTaskAcceptance('project-1', 'run-1', 'build');
    const reviewId = routed.tasks.build!.currentReviewerAssignmentId!;

    await expect(kernel.claimReviewerAssignment(
      'project-1', 'run-1', reviewId, 'intruder',
    )).rejects.toThrow('Acceptance authority denied');
    await expect(kernel.claimReviewerAssignment(
      'project-1', 'run-1', reviewId, 'builder',
    )).rejects.toThrow('Producer cannot review its own Candidate');
    await kernel.claimReviewerAssignment('project-1', 'run-1', reviewId, 'reviewer-bob');
    await expect(kernel.evaluateTaskAcceptance('project-1', 'run-1', 'build'))
      .rejects.toThrow('already has an open Acceptance wait');
    lastAuthorityDecision!.projectId = 'forged-after-return';
    await expect(kernel.read('project-1', 'run-1')).resolves.toMatchObject({
      reviewerAssignments: { [reviewId]: { status: 'claimed' } },
    });
    const accepted = await kernel.submitReviewerVerdict(
      'project-1', 'run-1', reviewId, 'reviewer-bob', {
        candidateHash: TEST_CANDIDATE_HASH,
        criteria: [{ criterionId: 'criterion-build', status: 'passed', evidenceRefs: ['review://1'] }],
        acceptedClaimIds: ['claim-1'],
        rejectedClaimIds: [],
        evidenceRefs: ['review://1'],
      },
    );

    expect(accepted.tasks.build?.status).toBe('accepted');
    expect(accepted.status).toBe('completed');
    expect(accepted.reviewerAssignments[reviewId]).toMatchObject({
      status: 'passed', reviewerPrincipalId: 'reviewer-bob',
    });
    expect(accepted.tasks.build?.acceptanceRecord).toMatchObject({
      route: 'reviewer_required', reviewerAssignmentId: reviewId,
      acceptedClaimIds: ['claim-1'], rejectedClaimIds: [],
    });
    const events = await journal.read('run-1');
    const forgedVerdict = events.map((entry) => entry.type === 'reviewer.verdict_recorded'
      ? {
          ...entry,
          payload: {
            ...entry.payload,
            verdict: { ...(entry.payload.verdict as object), candidateHash: 'sha256:forged' },
          },
        }
      : entry);
    expect(() => replayWorkroom(forgedVerdict)).toThrow('stale for the current Candidate hash');
    const forgedSelfReview = events.map((entry) => entry.type === 'reviewer.claimed'
      ? {
          ...entry,
          payload: {
            ...entry.payload,
            reviewerPrincipalId: 'builder',
            authorization: { ...(entry.payload.authorization as object), principalId: 'builder' },
          },
        }
      : entry);
    expect(() => replayWorkroom(forgedSelfReview)).toThrow('Producer cannot review its own Candidate');
  });

  it('opens a hash-bound Sponsor Gate for high-risk mechanical work without Reviewer cost', async () => {
    const acceptancePolicy: WorkroomAcceptancePolicyDecisionPort = {
      ...pinnedAcceptancePolicy(),
      decide(input) {
        const baseline = lowRiskAcceptance(input);
        return {
          ...baseline,
          disposition: 'policy_blocked' as const,
          route: 'sponsor_required' as const,
          reason: 'Sponsor authority is required',
          riskAssessment: { ...baseline.riskAssessment, tier: 'high' as const },
          wait: {
            owner: 'sponsor:project-1',
            deadline: input.now + 20,
            allowedActions: ['approve', 'reject', 'request_changes', 'reopen', 'rebase', 'replan', 'cancel'] as const,
          },
        };
      },
    };
    const { kernel } = fixture(acceptancePolicy);
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Sponsor route' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'publish', title: 'Publish', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'publish');
    await claimAssignment(kernel, {
      taskKey: 'publish', assignmentId: 'assignment-1', owner: 'publisher', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(kernel, 'assignment-1', 'report://1');

    const routed = await kernel.evaluateTaskAcceptance('project-1', 'run-1', 'publish');
    expect(Object.keys(routed.reviewerAssignments)).toHaveLength(0);
    const gate = Object.values(routed.sponsorGates)[0];
    expect(gate).toMatchObject({
      taskKey: 'publish', candidateHash: TEST_CANDIDATE_HASH,
      contractId: 'contract:publish:1', owner: 'sponsor:project-1', deadline: 120, status: 'open',
    });
    await expect(kernel.decideSponsorGate('project-1', 'run-1', gate!.id, 'sponsor-alice', {
      candidateHash: TEST_CANDIDATE_HASH, decision: 'approve', reason: 'approve exact candidate',
    })).rejects.toThrow('Workroom Acceptance Authority Port is not installed');
    const cancelled = await kernel.execute('project-1', 'run-1', {
      type: 'cancel_run', reason: 'Sponsor cancelled the pending publication', controlDeadline: 130,
    });
    expect(cancelled.sponsorGates[gate!.id]?.status).toBe('cancelled');
    expect(cancelled.status).toBe('cancelled');
  });

  it('requires Reviewer then Sponsor for high-risk judgment and preserves claim disposition', async () => {
    const journal = new MemoryWorkroomJournal();
    const basePolicy = pinnedAcceptancePolicy();
    const kernel = new WorkroomKernel({
      journal,
      now: () => 100,
      createId: (() => { let id = 0; return () => `gated-id-${++id}`; })(),
      acceptanceAuthority: allowingAcceptanceAuthority(),
      acceptancePolicy: {
        ...basePolicy,
        pinContract(input) {
          const contract = basePolicy.pinContract(input);
          return {
            ...contract,
            criteria: [{ id: 'criterion-build', kind: 'judgment' as const, description: 'Editorial quality' }],
          };
        },
        decide(input) {
          const baseline = lowRiskAcceptance(input);
          return {
            ...baseline,
            disposition: 'policy_blocked' as const,
            route: 'reviewer_then_sponsor' as const,
            reason: 'Judgment and high-risk authority are required',
            candidate: {
              ...baseline.candidate,
              claimIds: ['claim-1', 'claim-2'],
            },
            riskAssessment: { ...baseline.riskAssessment, tier: 'high' as const },
            wait: {
              owner: 'reviewer-pool:default', deadline: input.now + 20,
              allowedActions: ['claim', 'submit_verdict', 'reassign', 'replan', 'cancel'] as const,
            },
            nextWait: {
              owner: 'sponsor:project-1', deadline: input.now + 40,
              allowedActions: ['approve', 'reject', 'request_changes', 'reopen', 'rebase', 'replan', 'cancel'] as const,
            },
          };
        },
      },
    });
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Two gates' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'publish', title: 'Publish', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'publish');
    await claimAssignment(kernel, {
      taskKey: 'publish', assignmentId: 'assignment-1', owner: 'writer', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(kernel, 'assignment-1', 'report://1');
    const routed = await kernel.evaluateTaskAcceptance('project-1', 'run-1', 'publish');
    const reviewId = routed.tasks.publish!.currentReviewerAssignmentId!;
    await kernel.claimReviewerAssignment('project-1', 'run-1', reviewId, 'reviewer-bob');
    const reviewed = await kernel.submitReviewerVerdict(
      'project-1', 'run-1', reviewId, 'reviewer-bob', {
        candidateHash: TEST_CANDIDATE_HASH,
        criteria: [{ criterionId: 'criterion-build', status: 'passed', evidenceRefs: ['review://1'] }],
        acceptedClaimIds: ['claim-1'],
        rejectedClaimIds: ['claim-2'],
        evidenceRefs: ['review://1'],
      },
    );
    expect(reviewed.tasks.publish?.status).toBe('awaiting_acceptance');
    expect(reviewed.reviewerAssignments[reviewId]?.status).toBe('passed');
    const gateId = reviewed.tasks.publish!.currentSponsorGateId!;
    expect(reviewed.sponsorGates[gateId]).toMatchObject({
      reviewerAssignmentId: reviewId, candidateHash: TEST_CANDIDATE_HASH, status: 'open',
    });

    await expect(kernel.decideSponsorGate('project-1', 'run-1', gateId, 'sponsor-alice', {
      candidateHash: 'sha256:wrong', decision: 'approve', reason: 'wrong target',
    })).rejects.toThrow('stale for the current Candidate hash');
    const accepted = await kernel.decideSponsorGate('project-1', 'run-1', gateId, 'sponsor-alice', {
      candidateHash: TEST_CANDIDATE_HASH, decision: 'approve', reason: 'approved exact candidate',
    });
    expect(accepted.tasks.publish?.status).toBe('accepted');
    expect(accepted.tasks.publish?.acceptanceRecord).toMatchObject({
      route: 'reviewer_then_sponsor',
      reviewerAssignmentId: reviewId,
      reviewerPrincipalId: 'reviewer-bob',
      sponsorGateId: gateId,
      sponsorPrincipalId: 'sponsor-alice',
      acceptedClaimIds: ['claim-1'],
      rejectedClaimIds: ['claim-2'],
    });
    const forgedSponsorHash = (await journal.read('run-1')).map((entry) => entry.type === 'sponsor_gate.decided'
      ? { ...entry, payload: { ...entry.payload, candidateHash: 'sha256:forged' } }
      : entry);
    expect(() => replayWorkroom(forgedSponsorHash)).toThrow('stale for the current Candidate hash');
  });

  it('rejects a policy route that removes the baseline Sponsor requirement', async () => {
    const acceptancePolicy: WorkroomAcceptancePolicyDecisionPort = {
      ...pinnedAcceptancePolicy(),
      decide(input) {
        const baseline = lowRiskAcceptance(input);
        return {
          ...baseline,
          disposition: 'policy_blocked' as const,
          route: 'reviewer_required' as const,
          reason: 'Incorrectly weakened route',
          riskAssessment: { ...baseline.riskAssessment, tier: 'high' as const },
          wait: {
            owner: 'reviewer-pool:default', deadline: input.now + 10,
            allowedActions: ['claim', 'submit_verdict', 'reassign', 'replan', 'cancel'] as const,
          },
        };
      },
    };
    const { journal, kernel } = fixture(acceptancePolicy);
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Route floor' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'publish', title: 'Publish', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'publish');
    await claimAssignment(kernel, {
      taskKey: 'publish', assignmentId: 'assignment-1', owner: 'publisher', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(kernel, 'assignment-1', 'report://1');

    await expect(kernel.evaluateTaskAcceptance('project-1', 'run-1', 'publish'))
      .rejects.toThrow('cannot remove the baseline Sponsor requirement');
    expect((await journal.read('run-1')).map(event => event.type)).not.toContain('reviewer.assigned');
  });

  it('uses the Journal sequence as the acceptance decision CAS fence', async () => {
    let waiting = 0;
    let release!: () => void;
    const bothEvaluating = new Promise<void>(resolve => { release = resolve; });
    const acceptancePolicy: WorkroomAcceptancePolicyDecisionPort = {
      ...pinnedAcceptancePolicy(),
      async decide(input) {
        waiting += 1;
        if (waiting === 2) release();
        await bothEvaluating;
        return lowRiskAcceptance(input);
      },
    };
    const journal = new MemoryWorkroomJournal();
    let id = 0;
    const options = {
      journal,
      now: () => 100,
      createId: () => `cas-${++id}`,
      acceptancePolicy,
    };
    const first = new WorkroomKernel(options);
    const second = new WorkroomKernel(options);
    await first.createRun({ runId: 'run-1', projectId: 'project-1', title: 'CAS acceptance' });
    await first.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 1,
    });
    await first.pinTaskAcceptance('project-1', 'run-1', 'build');
    await claimAssignment(first, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 200,
    });
    await first.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(first, 'assignment-1', 'report://1');

    const settled = await Promise.allSettled([
      first.evaluateTaskAcceptance('project-1', 'run-1', 'build'),
      second.evaluateTaskAcceptance('project-1', 'run-1', 'build'),
    ]);

    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.find(result => result.status === 'rejected'))
      .toMatchObject({ reason: expect.any(WorkroomSequenceConflictError) });
    expect((await journal.read('run-1')).filter(event => event.type === 'task.accepted')).toHaveLength(1);
  });

  it('does not expose a command that directly accepts a task', () => {
    // @ts-expect-error Acceptance is a Kernel-owned policy decision, not a public command.
    const forged: WorkroomCommand = { type: 'accept_task', taskKey: 'build', reportRef: 'report://1' };
    expect(forged.type).toBe('accept_task');
  });

  it('does not expose commands that bypass the Assignment observation authority', () => {
    // @ts-expect-error Executor heartbeats must enter through AssignmentObservationIngress.
    const heartbeat: WorkroomCommand = { type: 'heartbeat', assignmentId: 'assignment-1', leaseExpiresAt: 999 };
    // @ts-expect-error Executor completion must carry the typed Envelope-bound observation.
    const completion: WorkroomCommand = {
      type: 'complete_execution', assignmentId: 'assignment-1', reportRef: 'report://forged',
    };
    expect([heartbeat.type, completion.type]).toEqual(['heartbeat', 'complete_execution']);
  });

  it('creates a new task revision after rejected execution', async () => {
    const { kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Review' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'draft', title: 'Draft', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'draft');
    await claimAssignment(kernel, {
      taskKey: 'draft', assignmentId: 'assignment-1', owner: 'writer', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await completeAssignment(kernel, 'assignment-1', 'report://1');

    const rework = await kernel.execute('project-1', 'run-1', {
      type: 'request_rework', taskKey: 'draft', reason: 'missing evidence',
    });
    expect(rework.tasks.draft).toMatchObject({ status: 'ready', revision: 2, attempt: 0 });
    expect(rework.tasks.draft?.acceptanceContract).toBeUndefined();
    expect(rework.tasks.draft?.reportDigest).toBeUndefined();
    expect(rework.tasks.draft?.candidateRef).toBeUndefined();
    expect(rework.tasks.draft?.candidateHash).toBeUndefined();
    await expect(claimAssignment(kernel, {
      taskKey: 'draft', assignmentId: 'assignment-2', owner: 'writer', leaseExpiresAt: 300,
    })).rejects.toThrow('Acceptance Contract is not pinned');
  });

  it('recovers an expired lease without accepting its result', async () => {
    const { kernel, setNow } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Research' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'research', title: 'Research', required: true, maxAttempts: 2,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'research');
    await claimAssignment(kernel, {
      taskKey: 'research', assignmentId: 'assignment-1', owner: 'researcher', leaseExpiresAt: 120,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    setNow(121);

    const recovered = await kernel.execute('project-1', 'run-1', { type: 'advance_clock', now: 121 });
    expect(recovered.assignments['assignment-1']?.status).toBe('lost');
    expect(recovered.tasks.research).toMatchObject({ status: 'ready', attempt: 1 });
  });

  it('requires a strictly increasing fence when a new Assignment takes over a Task', async () => {
    const { kernel, setNow } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Fenced takeover' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 2,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
    await claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 120, fence: 1,
    });
    setNow(121);
    await kernel.execute('project-1', 'run-1', { type: 'advance_clock', now: 121 });

    await expect(claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-2', owner: 'builder', leaseExpiresAt: 200, fence: 1,
    })).rejects.toThrow('fence must advance');
  });

  it('revises a failed required task out of needs_replan', async () => {
    const { kernel, setNow } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Recover' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 1,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
    await claimAssignment(kernel, {
      taskKey: 'build', assignmentId: 'assignment-1', owner: 'builder', leaseExpiresAt: 120,
    });
    setNow(121);
    const exhausted = await kernel.execute('project-1', 'run-1', { type: 'advance_clock', now: 121 });
    expect(exhausted.status).toBe('needs_replan');

    const revised = await kernel.execute('project-1', 'run-1', {
      type: 'revise_task', taskKey: 'build', title: 'Build safely', reason: 'new plan', maxAttempts: 2,
    });
    expect(revised.status).toBe('active');
    expect(revised.tasks.build).toMatchObject({ status: 'ready', revision: 2, maxAttempts: 2 });
  });

  it('rejects cross-Project reads and commands even with a valid run id', async () => {
    const { kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Scoped' });
    await expect(kernel.read('project-2', 'run-1')).rejects.toThrow('does not belong');
    await expect(kernel.execute('project-2', 'run-1', {
      type: 'plan_task', taskKey: 'escape', title: 'Escape', required: true, maxAttempts: 1,
    })).rejects.toThrow('does not belong');
  });

  it('settles cancellation after an executor misses its control deadline', async () => {
    const { kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Cancel' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'write', title: 'Write', required: true, maxAttempts: 2,
    });
    await kernel.pinTaskAcceptance('project-1', 'run-1', 'write');
    await claimAssignment(kernel, {
      taskKey: 'write', assignmentId: 'assignment-1', owner: 'writer', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await kernel.execute('project-1', 'run-1', { type: 'cancel_run', reason: 'stop', controlDeadline: 130 });

    const cancelled = await kernel.execute('project-1', 'run-1', { type: 'advance_clock', now: 131 });
    expect(cancelled.assignments['assignment-1']).toMatchObject({
      status: 'cancelled', outcome: 'outcome_unknown',
    });
    expect(cancelled.tasks.write?.status).toBe('cancelled');
    expect(cancelled.status).toBe('cancelled');
  });

  it('rejects concurrent append against a stale sequence', async () => {
    const { journal, kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'CAS' });

    await expect(journal.append('run-1', -1, [])).rejects.toEqual(
      new WorkroomSequenceConflictError('run-1', -1, 0),
    );
  });

  it('rejects unknown or malformed persisted event facts', async () => {
    const rows = [{
      run_id: 'run-bad', sequence: 0, version: 1, type: 'run.teleported',
      payload_json: JSON.stringify({ eventId: 'bad', payload: {} }), occurred_at: 100,
    }];
    const journal = new DatabaseWorkroomJournal({
      transaction: async (operation: (transaction: any) => Promise<unknown>) => operation({
        select: () => ({ where: async () => rows }),
        insertMany: async () => undefined,
      }),
    }, { select: () => ({ where: async () => rows }) });
    await expect(journal.read('run-bad')).rejects.toThrow('Invalid Workroom event payload envelope');
  });

  it.each([
    ['progress ratio drift', 'assignment.progress', {
      assignmentId: 'assignment-1', observationId: 'observation-1',
      observationDigest: TEST_REPORT_DIGEST, envelopeDigest: TEST_CANDIDATE_HASH,
      progress: { summary: 'invalid', completedUnits: 2, totalUnits: 1 },
    }, 'completedUnits exceeds totalUnits'],
    ['progress extra field', 'assignment.progress', {
      assignmentId: 'assignment-1', observationId: 'observation-1',
      observationDigest: TEST_REPORT_DIGEST, envelopeDigest: TEST_CANDIDATE_HASH,
      progress: { summary: 'invalid', secret: true },
    }, 'progress keys'],
    ['progress body digest drift', 'assignment.progress', {
      assignmentId: 'assignment-1', observationId: 'observation-progress-drift',
      observationDigest: digestCanonicalWorkroomValue({
        version: 1,
        type: 'progress',
        observationId: 'observation-progress-drift',
        envelopeDigest: TEST_CANDIDATE_HASH,
        progress: { summary: 'original', completedUnits: 1, totalUnits: 2 },
      }),
      envelopeDigest: TEST_CANDIDATE_HASH,
      progress: { summary: 'drifted', completedUnits: 1, totalUnits: 2 },
    }, 'observationDigest'],
    ['completion missing report digest', 'assignment.execution_completed', {
      assignmentId: 'assignment-1', observationId: 'observation-1',
      observationDigest: TEST_REPORT_DIGEST, envelopeDigest: TEST_CANDIDATE_HASH,
      reportRef: 'report://1', candidateRef: 'candidate-1', candidateHash: TEST_CANDIDATE_HASH,
    }, 'payload keys'],
    ['completion body digest drift', 'assignment.execution_completed', {
      assignmentId: 'assignment-1', observationId: 'observation-completion-drift',
      observationDigest: digestCanonicalWorkroomValue({
        version: 1,
        type: 'execution_completed',
        observationId: 'observation-completion-drift',
        envelopeDigest: TEST_CANDIDATE_HASH,
        completion: {
          report: { ref: 'report://1', digest: TEST_REPORT_DIGEST },
          candidate: { ref: 'candidate-1', hash: TEST_CANDIDATE_HASH },
        },
      }),
      envelopeDigest: TEST_CANDIDATE_HASH,
      reportRef: 'report://1',
      reportDigest: TEST_REPORT_DIGEST,
      candidateRef: 'candidate-1',
      candidateHash: TEST_REPORT_DIGEST,
    }, 'observationDigest'],
  ] as const)('rejects persisted Assignment observation corruption: %s', async (
    _name,
    type,
    payload,
    message,
  ) => {
    const rows = [{
      run_id: 'run-corrupt-observation', sequence: 0, version: 1, type,
      payload_json: JSON.stringify({ eventId: 'corrupt-observation', payload }), occurred_at: 100,
    }];
    const journal = new DatabaseWorkroomJournal({
      transaction: async (operation: (transaction: any) => Promise<unknown>) => operation({
        select: () => ({ where: async () => rows }), insertMany: async () => undefined,
      }),
    }, { select: () => ({ where: async () => rows }) });
    await expect(journal.read('run-corrupt-observation')).rejects.toThrow(message);
  });

  it('rejects Assignment observation body drift while materializing a Journal append', async () => {
    const journal = new MemoryWorkroomJournal();
    const payload = {
      assignmentId: 'assignment-1',
      observationId: 'observation-materialize-drift',
      observationDigest: digestCanonicalWorkroomValue({
        version: 1,
        type: 'execution_completed',
        observationId: 'observation-materialize-drift',
        envelopeDigest: TEST_CANDIDATE_HASH,
        completion: {
          report: { ref: 'report://1', digest: TEST_REPORT_DIGEST },
          candidate: { ref: 'candidate-1', hash: TEST_CANDIDATE_HASH },
        },
      }),
      envelopeDigest: TEST_CANDIDATE_HASH,
      reportRef: 'report://1',
      reportDigest: TEST_REPORT_DIGEST,
      candidateRef: 'candidate-1',
      candidateHash: TEST_REPORT_DIGEST,
    };
    await expect(journal.append('run-materialize-drift', -1, [{
      eventId: 'materialize-drift',
      occurredAt: 100,
      type: 'assignment.execution_completed',
      payload,
    }])).rejects.toThrow('observationDigest');
  });

  it('keeps trusted heartbeat lease metadata outside the Executor observation digest', async () => {
    const payload = {
      assignmentId: 'assignment-1',
      observationId: 'observation-heartbeat-trusted-metadata',
      observationDigest: digestCanonicalWorkroomValue({
        version: 1,
        type: 'heartbeat',
        observationId: 'observation-heartbeat-trusted-metadata',
        envelopeDigest: TEST_CANDIDATE_HASH,
      }),
      envelopeDigest: TEST_CANDIDATE_HASH,
      leaseExpiresAt: 999,
    };
    const rows = [{
      run_id: 'run-heartbeat-metadata', sequence: 0, version: 1, type: 'assignment.heartbeat',
      payload_json: JSON.stringify({ eventId: 'heartbeat-metadata', payload }), occurred_at: 100,
    }];
    const journal = new DatabaseWorkroomJournal({
      transaction: async (operation: (transaction: any) => Promise<unknown>) => operation({
        select: () => ({ where: async () => rows }), insertMany: async () => undefined,
      }),
    }, { select: () => ({ where: async () => rows }) });
    await expect(journal.read('run-heartbeat-metadata')).resolves.toMatchObject([{
      payload: { leaseExpiresAt: 999 },
    }]);
  });

  it('rejects a persisted acceptance event without a valid policy record', async () => {
    const rows = [{
      run_id: 'run-bad-acceptance', sequence: 0, version: 1, type: 'task.accepted',
      payload_json: JSON.stringify({
        eventId: 'bad-acceptance',
        payload: { taskKey: 'build', reportRef: 'report://1', record: {} },
      }),
      occurred_at: 100,
    }];
    const journal = new DatabaseWorkroomJournal({
      transaction: async (operation: (transaction: any) => Promise<unknown>) => operation({
        select: () => ({ where: async () => rows }),
        insertMany: async () => undefined,
      }),
    }, { select: () => ({ where: async () => rows }) });

    await expect(journal.read('run-bad-acceptance'))
      .rejects.toThrow('Invalid Workroom Acceptance Record');
  });

  it('persists a contiguous journal in one serializable transaction', async () => {
    const rows: Record<string, unknown>[] = [];
    const where = async ({ run_id }: Record<string, unknown>) =>
      run_id === undefined ? rows : rows.filter(row => row.run_id === run_id);
    const database = {
      transaction: async <T>(operation: (transaction: any) => Promise<T>, options: unknown) => {
        expect(options).toEqual({ isolationLevel: 'SERIALIZABLE' });
        return operation({
          select: () => ({ where }),
          insertMany: async (_table: string, inserted: Record<string, unknown>[]) => {
            rows.push(...inserted);
          },
        });
      },
    };
    const journal = new DatabaseWorkroomJournal(database, { select: () => ({ where }) });
    const kernel = new WorkroomKernel({
      journal,
      now: () => 100,
      createId: (() => {
        let id = 0;
        return () => `db-${++id}`;
      })(),
    });

    await kernel.createRun({ runId: 'run-db', projectId: 'project-db', title: 'Persisted' });
    await expect(journal.append('run-db', -1, [])).rejects.toEqual(
      new WorkroomSequenceConflictError('run-db', -1, 0),
    );
    const state = await kernel.execute('project-db', 'run-db', {
      type: 'plan_task', taskKey: 'task', title: 'Task', required: true, maxAttempts: 1,
    });

    expect(state.sequence).toBe(1);
    expect(rows.map(row => row.id)).toEqual(['run-db:0', 'run-db:1']);
    expect(await kernel.read('project-db', 'run-db')).toEqual(state);
    expect(await kernel.list('project-db')).toEqual([state]);
  });

  it('fails closed until the candidate activates exactly one journal', async () => {
    const journal = new ActivatableWorkroomJournal();
    const kernel = new WorkroomKernel({ journal });
    await expect(kernel.createRun({ projectId: 'project', title: 'inactive' }))
      .rejects.toThrow('Workroom journal is not active');

    journal.activate(new MemoryWorkroomJournal());
    await expect(kernel.createRun({ runId: 'active', projectId: 'project', title: 'active' }))
      .resolves.toMatchObject({ runId: 'active' });
    expect(() => journal.activate(new MemoryWorkroomJournal())).toThrow('already active');
  });

  it('atomically persists and replays file-backed runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-workroom-'));
    try {
      const first = new WorkroomKernel({
        journal: new FileWorkroomJournal(directory),
        now: () => 100,
        createId: (() => { let id = 0; return () => `file-${++id}`; })(),
      });
      await first.createRun({ runId: 'file-run', projectId: 'file-project', title: 'File' });
      await first.execute('file-project', 'file-run', {
        type: 'plan_task', taskKey: 'task', title: 'Task', required: true, maxAttempts: 1,
      });

      const restarted = new WorkroomKernel({ journal: new FileWorkroomJournal(directory) });
      expect(await restarted.read('file-project', 'file-run')).toMatchObject({ sequence: 1, projectId: 'file-project' });
      expect((await restarted.list('file-project')).map(run => run.runId)).toEqual(['file-run']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('enforces file CAS across generation journal instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-workroom-cas-'));
    try {
      const first = new FileWorkroomJournal(directory);
      const second = new FileWorkroomJournal(directory);
      const create = {
        eventId: 'create',
        occurredAt: 100,
        type: 'run.created' as const,
        payload: { projectId: 'project', title: 'Run' },
      };
      await first.append('shared-run', -1, [create]);
      const draft = (eventId: string) => ({
        eventId,
        occurredAt: 101,
        type: 'task.planned' as const,
        payload: { taskKey: eventId, title: eventId, required: true, maxAttempts: 1 },
      });

      const settled = await Promise.allSettled([
        first.append('shared-run', 0, [draft('left')]),
        second.append('shared-run', 0, [draft('right')]),
      ]);

      expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.find(result => result.status === 'rejected');
      expect(rejected).toMatchObject({ reason: expect.any(WorkroomSequenceConflictError) });
      const events = await first.read('shared-run');
      expect(events.map(event => event.sequence)).toEqual([0, 1]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

});

async function claimAssignment(
  kernel: WorkroomKernel,
  input: Readonly<{
    taskKey: string;
    assignmentId: string;
    owner: string;
    leaseExpiresAt: number;
    fence?: number;
  }>,
) {
  const state = await kernel.read('project-1', 'run-1');
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
  assignmentId: string,
  reportRef: string,
) {
  const envelope = TEST_ENVELOPES.get(kernel)?.get(assignmentId);
  if (!envelope) throw new Error(`Execution Envelope ${assignmentId} not found`);
  const state = await kernel.read(envelope.projectId, envelope.runId);
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
