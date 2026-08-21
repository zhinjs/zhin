import { vi } from 'vitest';
import {
  PinnedWorkroomAcceptancePolicy,
  type WorkroomAcceptancePolicyFactsPort,
  type WorkroomTrustedRiskFactsPort,
} from '../../src/plugin-runtime/workroom-risk-acceptance-runtime.js';
import type { WorkroomAcceptanceDecisionInput } from '../../src/workroom/acceptance-policy.js';
import { createWorkroomStructuredTaskReport } from '../../src/workroom/workroom-task-report-store.js';

const SHA = (char: string) => `sha256:${char.repeat(64)}`;

describe('Pinned Workroom Risk Acceptance policy', () => {
  it('auto-accepts only trusted low-risk deterministic reports without creating a Reviewer', async () => {
    const policy = new PinnedWorkroomAcceptancePolicy({
      policies: policyFacts('deterministic'),
      reports: { read: vi.fn(async input => {
        expect(input.purpose).toBe('acceptance-evaluation');
        return report();
      }) },
      risk: riskFacts({
        sideEffect: 'none', reversibility: 'discard_only', dataClass: 'internal',
        blastRadius: 'single_artifact', uncertainty: 'known', capabilityTags: [],
      }),
      checks: { run: async input => ({
        id: 'check:tests', criterionId: input.criterion.id, status: 'passed',
        candidateHash: input.candidateHash, runner: 'trusted-ci', runnerVersion: '1',
        evidenceRefs: ['workroom-evidence:test'],
      }) },
    });

    const decision = await policy.decide(decisionInput());
    expect(decision).toMatchObject({
      disposition: 'accepted', route: 'auto_accept',
      riskAssessment: { tier: 'low', assessor: 'kernel-risk-lattice:1' },
      acceptedClaimIds: [report().claims[0]!.id], rejectedClaimIds: [],
    });
    expect(decision.riskAssessment.sourceRefs).toEqual(['risk-source:plan']);
  });

  it('routes judgment through an independent Reviewer and high risk through Sponsor', async () => {
    const provider = (kind: 'deterministic' | 'judgment', sideEffect: 'none' | 'external') =>
      new PinnedWorkroomAcceptancePolicy({
        policies: policyFacts(kind),
        reports: { read: async () => report() },
        risk: riskFacts({
          sideEffect, reversibility: sideEffect === 'none' ? 'discard_only' : 'compensatable',
          dataClass: 'internal', blastRadius: sideEffect === 'none' ? 'single_artifact' : 'external',
          uncertainty: 'known', capabilityTags: sideEffect === 'none' ? [] : ['publish'],
        }),
        checks: { run: async input => ({
          id: 'check:tests', criterionId: input.criterion.id, status: 'passed',
          candidateHash: input.candidateHash, runner: 'trusted-ci', runnerVersion: '1',
          evidenceRefs: ['workroom-evidence:test'],
        }) },
      });

    await expect(provider('judgment', 'none').decide(decisionInput('judgment'))).resolves.toMatchObject({
      disposition: 'policy_blocked', route: 'reviewer_required',
      wait: { owner: 'reviewer-pool', allowedActions: expect.arrayContaining(['reassign', 'cancel']) },
    });
    await expect(provider('deterministic', 'external').decide(decisionInput())).resolves.toMatchObject({
      disposition: 'policy_blocked', route: 'sponsor_required',
      riskAssessment: { tier: 'high' },
      wait: { owner: 'sponsor-pool', allowedActions: expect.arrayContaining(['reopen', 'cancel']) },
    });
  });

  it('fails closed on stale or model-shaped Risk Facts', async () => {
    const facts = riskFacts({
      sideEffect: 'none', reversibility: 'discard_only', dataClass: 'internal',
      blastRadius: 'single_artifact', uncertainty: 'known', capabilityTags: [],
    });
    const policy = new PinnedWorkroomAcceptancePolicy({
      policies: policyFacts('deterministic'), reports: { read: async () => report() },
      risk: { assess: async input => ({ ...await facts.assess(input), candidateHash: SHA('9') }) },
      checks: { run: vi.fn() },
    });

    await expect(policy.decide(decisionInput())).rejects.toThrow('Risk Facts candidate binding');
  });

  it('does not let an unknown runtime Risk dimension fall through to low risk', async () => {
    const policy = new PinnedWorkroomAcceptancePolicy({
      policies: policyFacts('deterministic'), reports: { read: async () => report() },
      risk: { assess: async input => ({
        candidateHash: input.candidateHash,
        facts: {
          sideEffect: 'model-says-safe', reversibility: 'discard_only', dataClass: 'internal',
          blastRadius: 'single_artifact', uncertainty: 'known', capabilityTags: [],
        } as never,
        sources: [{
          sourceType: 'workflow-plan', sourceRef: 'risk-source:plan', sourceDigest: SHA('3'),
          issuer: 'workroom-kernel-plan-projector', policyRevision: 1,
        }],
      }) },
      checks: { run: vi.fn() },
    });

    await expect(policy.decide(decisionInput())).rejects.toThrow('Risk side effect is invalid');
  });
});

function policyFacts(kind: 'deterministic' | 'judgment'): WorkroomAcceptancePolicyFactsPort {
  return {
    resolve: async input => ({
      profileRef: `profile:${input.projectId}:1`, profileDigest: SHA('1'),
      policy: { id: 'acceptance-policy-1', revision: 1, digest: SHA('2') },
      kind: 'task_result',
      criteria: [{ id: 'tests', kind, description: 'Trusted tests pass' }],
      requiredEvidence: ['workroom-evidence:test'],
      minimumRoute: 'baseline', reviewerOwner: 'reviewer-pool', sponsorOwner: 'sponsor-pool',
      reviewerTimeoutMs: 10_000, sponsorTimeoutMs: 20_000,
      binding: {
        sourceType: 'project-profile', sourceRef: `profile:${input.projectId}:1`,
        sourceDigest: SHA('1'), issuer: 'profile-registry', policyRevision: 1,
      },
    }),
  };
}

function riskFacts(facts: {
  sideEffect: 'none' | 'local' | 'external' | 'unknown';
  reversibility: 'discard_only' | 'compensatable' | 'irreversible' | 'unknown';
  dataClass: 'public' | 'internal' | 'confidential' | 'restricted' | 'unknown';
  blastRadius: 'single_artifact' | 'project' | 'organization' | 'external' | 'unknown';
  uncertainty: 'known' | 'unknown';
  capabilityTags: readonly string[];
}): WorkroomTrustedRiskFactsPort {
  return {
    assess: async input => ({
      candidateHash: input.candidateHash,
      facts,
      sources: [{
        sourceType: 'workflow-plan', sourceRef: 'risk-source:plan', sourceDigest: SHA('3'),
        issuer: 'workroom-kernel-plan-projector', policyRevision: 1,
      }],
    }),
  };
}

function report() {
  return createWorkroomStructuredTaskReport({
    projectId: 'project-1', runId: 'run-1', planRef: 'plan:1', planRevision: 1,
    taskKey: 'build', taskRevision: 1,
    assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 7,
    claims: [{
      label: 'claim-1', key: 'build.result', value: 'passed', status: 'verified' as const,
      evidenceRefs: ['workroom-evidence:test'], artifactRefs: ['artifact:change-set'],
    }],
  });
}

function decisionInput(kind: 'deterministic' | 'judgment' = 'deterministic'): WorkroomAcceptanceDecisionInput {
  return {
    projectId: 'project-1', runId: 'run-1', expectedSequence: 10, now: 1_000,
    contract: {
      id: 'contract:build:1', revision: 1, digest: SHA('5'), taskKey: 'build', taskRevision: 1,
      kind: 'task_result', policy: { id: 'acceptance-policy-1', revision: 1, digest: SHA('2') },
      criteria: [{ id: 'tests', kind, description: 'Trusted tests pass' }],
      requiredEvidence: ['workroom-evidence:test'],
    },
    task: { key: 'build', revision: 1, reportRef: report().ref },
    assignment: {
      id: 'assignment-1', owner: 'executor-1', reportRef: report().ref, reportDigest: report().digest,
      candidateRef: 'candidate:1', candidateHash: report().candidateHash,
    },
  };
}
