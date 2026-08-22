import { vi } from 'vitest';
import {
  createWorkroomReviewerVerdictCommandPort,
  ProfileWorkroomAcceptanceAuthority,
  WorkroomReviewerViewReader,
} from '../../src/plugin-runtime/workroom-reviewer-authority-runtime.js';
import type { WorkroomRunState } from '../../src/workroom/kernel-contracts.js';

describe('Workroom Reviewer and Sponsor production authority', () => {
  it('rejects producer self-review and exposes a governed read-only Reviewer View', async () => {
    const state = runState();
    const principals = { resolve: vi.fn(async ({ principalId }) => ({
      principalId,
      roles: principalId === 'reviewer-1' ? ['reviewer'] as const : ['executor'] as const,
      profileRef: 'profile:1', profileDigest: sha('a'), revision: 1, issuer: 'profile-registry',
      catalogRevision: 'catalog-1', projectDigest: sha('b'),
    })) };
    const authority = new ProfileWorkroomAcceptanceAuthority({
      principals,
      runState: { read: async () => state },
    });

    await expect(authority.authorize({
      action: 'claim_review', principalId: 'executor-1', requiredRole: 'reviewer',
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      targetId: 'review-1', expectedSequence: 8,
    })).resolves.toMatchObject({ authorized: false, reason: expect.stringContaining('producer') });
    await expect(authority.authorize({
      action: 'claim_review', principalId: 'reviewer-1', requiredRole: 'reviewer',
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      targetId: 'review-1', expectedSequence: 8,
    })).resolves.toMatchObject({
      authorized: true, role: 'reviewer', authorizedBy: expect.stringMatching(/^profile-authority:/u),
    });

    const reports = { read: vi.fn(async input => {
      expect(input.purpose).toBe('acceptance-review');
      return report();
    }) };
    const view = await new WorkroomReviewerViewReader({
      runState: { read: async () => ({
        ...state,
        reviewerAssignments: {
          'review-1': { ...state.reviewerAssignments['review-1']!, status: 'claimed', reviewerPrincipalId: 'reviewer-1' },
        },
      }) },
      reports,
    }).read({
      projectId: 'project-1', runId: 'run-1', assignmentId: 'review-1', principalId: 'reviewer-1',
    });

    expect(view).toMatchObject({
      projectId: 'project-1', taskKey: 'build', candidateHash: sha('c'),
      producerPrincipalId: 'executor-1', report: { claims: [{ id: 'claim-1' }] },
    });
    expect(view).not.toHaveProperty('workspace');
    expect(view).not.toHaveProperty('capabilityPlan');
    expect(JSON.stringify(view)).not.toContain('mountRef');
  });

  it('requires an exact Profile sponsor role for the current Sponsor Gate', async () => {
    const state = runState();
    const authority = new ProfileWorkroomAcceptanceAuthority({
      principals: { resolve: async ({ principalId }) => ({
        principalId, roles: principalId === 'sponsor-1' ? ['sponsor'] : ['reviewer'],
        profileRef: 'profile:1', profileDigest: sha('a'), revision: 1, issuer: 'profile-registry',
        catalogRevision: 'catalog-1', projectDigest: sha('b'),
      }) },
      runState: { read: async () => state },
    });
    const input = {
      action: 'decide_sponsor' as const, principalId: 'sponsor-1', requiredRole: 'sponsor' as const,
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      targetId: 'sponsor-1', expectedSequence: 8,
    };
    await expect(authority.authorize(input)).resolves.toMatchObject({ authorized: true });
    await expect(authority.authorize({ ...input, targetId: 'stale-gate' }))
      .resolves.toMatchObject({ authorized: false, reason: expect.stringContaining('current') });
  });

  it('binds Reviewer verdict submission to one trusted Assignment and principal', async () => {
    const submitReviewerVerdict = vi.fn(async () => runState());
    const command = createWorkroomReviewerVerdictCommandPort({
      kernel: { submitReviewerVerdict },
      binding: {
        projectId: 'project-1',
        runId: 'run-1',
        assignmentId: 'review-1',
        principalId: 'reviewer-1',
      },
    });
    const verdict = {
      candidateHash: sha('c'),
      criteria: [{ criterionId: 'quality', status: 'passed' as const, evidenceRefs: ['evidence:1'] }],
      acceptedClaimIds: ['claim-1'], rejectedClaimIds: [], evidenceRefs: ['evidence:1'],
    };

    await command.submit(verdict);

    expect(Object.keys(command)).toEqual(['submit']);
    expect(command).not.toHaveProperty('claim');
    expect(command).not.toHaveProperty('decideSponsorGate');
    expect(submitReviewerVerdict).toHaveBeenCalledWith(
      'project-1', 'run-1', 'review-1', 'reviewer-1', verdict,
    );
  });
});

function runState(): WorkroomRunState {
  const evaluation = {
    version: 1, disposition: 'policy_blocked', route: 'reviewer_required',
    candidate: {
      id: 'candidate-1', taskKey: 'build', taskRevision: 1,
      producerAssignmentId: 'assignment-1', producerPrincipalId: 'executor-1',
      reportRef: 'workroom-report:1', hash: sha('c'), claimIds: ['claim-1'], evidenceRefs: [],
    },
    contract: contract(), riskAssessment: {
      id: 'risk-1', candidateHash: sha('c'), tier: 'medium', factsHash: sha('d'),
      assessor: 'kernel-risk-lattice:1', sourceRefs: ['plan:1'],
    },
    checkResults: [], acceptedClaimIds: [], rejectedClaimIds: [],
    decidedBy: 'acceptance-policy:policy-1', reason: 'review',
  } as const;
  const common = {
    taskKey: 'build', taskRevision: 1, candidateHash: sha('c'), riskTier: 'medium' as const,
    route: 'reviewer_required' as const, contractId: 'contract:1', policy: contract().policy,
    owner: 'reviewer-pool', deadline: 1000,
    allowedActions: ['claim', 'submit_verdict', 'reassign', 'replan', 'cancel'] as const,
    evaluation,
  };
  return {
    projectId: 'project-1', runId: 'run-1', title: 'Run', status: 'active', sequence: 8,
    now: 100, cancelRequested: false,
    tasks: { build: {
      key: 'build', title: 'Build', status: 'awaiting_acceptance', revision: 1, attempt: 1,
      maxAttempts: 1, required: true, blockers: [], currentAssignmentId: 'assignment-1',
      reportRef: 'workroom-report:1', candidateHash: sha('c'), acceptanceContract: contract(),
      currentReviewerAssignmentId: 'review-1', currentSponsorGateId: 'sponsor-1',
    } },
    assignments: {},
    reviewerAssignments: { 'review-1': {
      ...common, id: 'review-1', producerPrincipalId: 'executor-1', status: 'open',
    } },
    sponsorGates: { 'sponsor-1': {
      ...common, id: 'sponsor-1', route: 'sponsor_required', status: 'open',
    } },
  } as WorkroomRunState;
}

function contract() {
  return {
    id: 'contract:1', revision: 1, digest: sha('e'), taskKey: 'build', taskRevision: 1,
    kind: 'task_result' as const, policy: { id: 'policy-1', revision: 1, digest: sha('f') },
    criteria: [{ id: 'quality', kind: 'judgment' as const, description: 'Quality' }],
    requiredEvidence: [],
  };
}

function report() {
  return {
    ref: 'workroom-report:1', candidateHash: sha('c'), projectId: 'project-1', runId: 'run-1',
    planRef: 'plan:1', planRevision: 1, taskKey: 'build', taskRevision: 1,
    claims: [{ id: 'claim-1', key: 'result', value: 'ok', status: 'assumed' as const, evidenceRefs: [], artifactRefs: [] }],
  };
}

function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
