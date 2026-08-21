import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SponsorDecisionWorkroomEffectAuthorizationProjector,
  WorkroomEffectAuthorizationProjectionRuntime,
  installWorkroomAcceptanceResources,
} from '../../src/plugin-runtime/workroom-acceptance-production-composition.js';
import {
  createWorkroomGovernedAcceptanceProjection,
  createWorkroomKernelRiskHeader,
} from '../../src/plugin-runtime/workroom-acceptance-provider-composition.js';
import {
  workroomAcceptancePolicyDecisionToken,
} from '../../src/plugin-runtime/workroom-acceptance-policy.js';
import {
  workroomAcceptanceAuthorityToken,
} from '../../src/plugin-runtime/workroom-acceptance-authority.js';
import {
  workroomAcceptanceCheckRunnerToken,
  workroomTrustedRiskFactsToken,
} from '../../src/plugin-runtime/workroom-risk-acceptance-runtime.js';
import {
  workroomExecutionContextReleaseToken,
  workroomProjectMemorySchemaAuthorityToken,
} from '../../src/plugin-runtime/workroom-accepted-source-runtime.js';
import {
  workroomAcceptancePrincipalRegistryToken,
  workroomReviewerViewReaderToken,
} from '../../src/plugin-runtime/workroom-reviewer-authority-runtime.js';
import {
  GenerationOwnedP7EffectAuthorization,
  workroomPersistedEffectAuthorizationFactsToken,
} from '../../src/plugin-runtime/workroom-effect-production.js';
import {
  MemoryWorkroomEffectJournal,
  WorkroomEffectLedger,
  createWorkroomEffectIntent,
} from '../../src/workroom/effect-ledger.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const SHA = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

describe('P7 standard Acceptance production composition', () => {
  it('publishes generation-owned resources and durably blocks missing Check/Context providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-acceptance-composition-'));
    const stateRoot = join(root, '.zhin');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateRoot);
    const resources = scope();
    const effectJournal = new MemoryWorkroomEffectJournal();
    installWorkroomAcceptanceResources({
      projectRoot: root, generation: 7, signal: new AbortController().signal,
      resources, profiles: profiles(), catalog: catalog(),
      reports: { read: async () => report() },
      projections: { resolve: async () => null },
      riskHeaders: { resolve: async () => [] },
      effectJournal,
      runState: { read: async () => runState() },
      checks: [],
      effectAuthorizationPolicy: { authorize: async () => null },
    });

    for (const token of [
      workroomAcceptancePolicyDecisionToken,
      workroomAcceptanceAuthorityToken,
      workroomAcceptancePrincipalRegistryToken,
      workroomReviewerViewReaderToken,
      workroomProjectMemorySchemaAuthorityToken,
      workroomExecutionContextReleaseToken,
      workroomPersistedEffectAuthorizationFactsToken,
    ]) expect(resources.has(token)).toBe(true);

    await expect(resources.use(workroomAcceptanceCheckRunnerToken).run({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      criterion: { id: 'tests', kind: 'deterministic', description: 'Tests pass' },
      candidateHash: SHA('4'), reportRef: 'workroom-report:1', evidenceRefs: [],
      policy: { id: 'policy-1', revision: 1, digest: SHA('5') },
    })).resolves.toMatchObject({ status: 'error', runner: 'provider-blocker' });

    const eligibility = {
      eligible: true as const, ref: 'context-release:1', projectId: 'project-1', runId: 'run-1',
      taskKey: 'build', sourceAcceptanceId: 'acceptance-1', sourceHash: SHA('6'),
      taskMemoryId: 'memory-1', statePatchId: 'patch-1', stateRevision: 1,
    };
    await expect(resources.use(workroomExecutionContextReleaseToken).release({
      operationId: `context-release-operation:${digest(eligibility)}`, eligibility,
    })).resolves.toMatchObject({ status: 'outcome_unknown' });

    await expect(resources.use(workroomAcceptancePolicyDecisionToken).pinContract({
      projectId: 'project-1', runId: 'run-1', expectedSequence: 0, now: 1,
      task: { key: 'build', title: 'Build', revision: 1 },
    })).rejects.toThrow('Governed Acceptance projection is unavailable');
    await expect(resources.use(workroomTrustedRiskFactsToken).assess({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
      candidateHash: SHA('4'), planRef: 'plan:1', planRevision: 1, artifactRefs: [],
      policy: { id: 'policy-1', revision: 1, digest: SHA('5') },
    })).rejects.toThrow('Kernel Risk headers are unavailable');

    const blockerFiles = await readdir(join(stateRoot, 'workroom-acceptance-provider-blockers'));
    expect(blockerFiles.filter(name => name.endsWith('.json')).length).toBeGreaterThanOrEqual(4);
  });

  it('projects only authenticated typed Effect Sponsor approval through exact P8 policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-effect-sponsor-projector-'));
    const stateRoot = join(root, '.zhin');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateRoot);
    const effects = new MemoryWorkroomEffectJournal();
    const ledger = new WorkroomEffectLedger(effects);
    const intent = createWorkroomEffectIntent(effectIntent());
    await ledger.recordIntent('project-1', intent);
    const authorize = vi.fn(async input => ({
      approved: true as const,
      policy: input.acceptancePolicy,
      expiresAt: 10_000,
      policyDecisionRef: 'effect-policy-decision:1',
      policyDecisionDigest: SHA('9'),
    }));
    const projector = new SponsorDecisionWorkroomEffectAuthorizationProjector({
      directory: join(stateRoot, 'workroom-effect-authorization-facts'),
      effectJournal: effects,
      sponsorAuthority: { authorize: async input => ({
        authorized: true, authorizedBy: 'catalog:revision-1:project-digest',
        catalogRevision: 'c'.repeat(64), projectDigest: SHA('c'),
        profileRef: 'profile:project-1:profile-1', profileDigest: SHA('d'), profileRevision: 1,
        binding: {
          effectIntentId: intent.id, effectIntentDigest: intent.digest,
          candidateHash: intent.candidateHash, assignmentAttempt: 1, workspaceFence: 4,
          workspaceRef: intent.target.ref, workspaceDigest: intent.target.digest,
          preconditionsDigest: digest(intent.preconditions), risk: intent.risk,
          policy: { id: 'effect-policy', revision: 1, digest: SHA('7') },
          deadline: 10_000,
        },
        requestDigest: input.digest,
      }) },
      policy: { authorize },
    });

    await projector.control.decide({
      version: 1, operationId: 'effect-sponsor-decision:1', projectId: 'project-1',
      runId: 'run-1', effectIntentId: intent.id, effectIntentDigest: intent.digest,
      principalId: 'human:sponsor-1', decision: 'approve', reason: 'ship', decidedAt: 2,
    });
    expect(await projector.drainProject('project-1')).toBe(1);
    const authority = new GenerationOwnedP7EffectAuthorization(() => projector);
    await expect(authority.authorize({
      projectId: 'project-1', expectedSequence: 0, now: 3, intent,
    })).resolves.toMatchObject({
      authorized: true, intentId: intent.id, candidateHash: intent.candidateHash,
      authorizedBy: expect.stringContaining('human:sponsor-1'),
    });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', candidateHash: intent.candidateHash,
      sponsorDecision: expect.objectContaining({
        principalId: 'human:sponsor-1', effectIntentId: intent.id,
        binding: expect.objectContaining({ workspaceFence: 4 }),
      }),
    }));

    const discussionOnly = new SponsorDecisionWorkroomEffectAuthorizationProjector({
      directory: join(stateRoot, 'discussion-only'),
      effectJournal: effects,
      sponsorAuthority: projector.options.sponsorAuthority,
      policy: { authorize },
    });
    expect(await discussionOnly.drainProject('project-1')).toBe(0);
  });

  it('drains Effect authorization facts under generation lifecycle and restart without duplication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-effect-projector-runtime-'));
    const directory = join(root, 'facts');
    const effects = new MemoryWorkroomEffectJournal();
    const intent = createWorkroomEffectIntent(effectIntent());
    await new WorkroomEffectLedger(effects).recordIntent('project-1', intent);
    const authorize = vi.fn(async input => ({
      approved: true as const,
      policy: input.acceptancePolicy,
      expiresAt: 10_000,
      policyDecisionRef: 'effect-policy-decision:restart',
      policyDecisionDigest: SHA('9'),
    }));
    const sponsorAuthority = { authorize: async (input: { digest: string }) => ({
      authorized: true as const, authorizedBy: 'catalog:revision-1:project-digest',
      catalogRevision: 'c'.repeat(64), projectDigest: SHA('c'),
      profileRef: 'profile:project-1:profile-1', profileDigest: SHA('d'), profileRevision: 1,
      binding: {
        effectIntentId: intent.id, effectIntentDigest: intent.digest,
        candidateHash: intent.candidateHash, assignmentAttempt: 1, workspaceFence: 4,
        workspaceRef: intent.target.ref, workspaceDigest: intent.target.digest,
        preconditionsDigest: digest(intent.preconditions), risk: intent.risk,
        policy: { id: 'effect-policy', revision: 1, digest: SHA('7') }, deadline: 10_000,
      },
      requestDigest: input.digest,
    }) };
    const firstProjector = new SponsorDecisionWorkroomEffectAuthorizationProjector({
      directory, effectJournal: effects, sponsorAuthority, policy: { authorize },
    });
    await firstProjector.control.decide({
      version: 1, operationId: 'effect-sponsor-decision:restart', projectId: 'project-1',
      runId: 'run-1', effectIntentId: intent.id, effectIntentDigest: intent.digest,
      principalId: 'human:sponsor-1', decision: 'approve', reason: 'ship', decidedAt: 2,
    });
    const first = new WorkroomEffectAuthorizationProjectionRuntime({
      signal: new AbortController().signal,
      projects: { listProjectIds: async () => ['project-1', 'project-1'] },
      projector: firstProjector,
      intervalMs: 5,
    });
    first.start();
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
    first.dispose();

    const restartedProjector = new SponsorDecisionWorkroomEffectAuthorizationProjector({
      directory, effectJournal: effects, sponsorAuthority, policy: { authorize },
    });
    const restarted = new WorkroomEffectAuthorizationProjectionRuntime({
      signal: new AbortController().signal,
      projects: { listProjectIds: async () => ['project-1'] },
      projector: restartedProjector,
      intervalMs: 5,
    });
    restarted.start();
    await new Promise(resolve => setTimeout(resolve, 20));
    restarted.dispose();
    expect(authorize).toHaveBeenCalledTimes(1);
  });
});

function scope() {
  const values = new Map<object, unknown>();
  return {
    has: (token: object) => values.has(token),
    provide: <T>(token: object, value: T) => { values.set(token, value); },
    use: <T>(token: object): T => {
      if (!values.has(token)) throw new Error('missing resource');
      return values.get(token) as T;
    },
  };
}

function profiles() {
  const compiled = {
    revisionId: 'profile-1', projectId: 'project-1', charterRevisionId: 'charter-1',
    packRefs: [], tools: [], skills: [], agents: [
      { id: 'executor-1', digest: SHA('1'), role: 'executor', allowedTools: [], allowedSkills: [] },
      { id: 'reviewer-1', digest: SHA('2'), role: 'reviewer', allowedTools: [], allowedSkills: [] },
    ], workflows: [], memories: [], glossaries: [],
  };
  const compiledDigest = digest(compiled);
  return { read: async () => ({
    projectId: 'project-1', registryRevision: 2,
    active: { revisionId: 'profile-1', compiledDigest, activatedAtRegistryRevision: 1 },
    runPins: { 'run-1': {
      projectId: 'project-1', runId: 'run-1', profileRevisionId: 'profile-1',
      profileDigest: compiledDigest, activationRegistryRevision: 1, pinnedAtRegistryRevision: 2,
    } },
    revisions: { 'profile-1': {
      revisionId: 'profile-1', projectId: 'project-1', charterRevisionId: 'charter-1',
      packRefs: [], overlayDigest: SHA('3'), compiledDigest,
      compiledProfile: { ...compiled, digest: compiledDigest },
      source: { kind: 'sponsor_decision' as const, sourceId: 'profile-decision-1' },
      governanceDecision: {} as never,
    } },
  }) };
}

function catalog() {
  return { read: async () => ({
    revision: 'c'.repeat(64),
    definitions: { 'project-1': {
      name: 'Project One', enabled: true,
      members: [
        { agent: 'executor-1', role: 'executor' as const },
        { agent: 'reviewer-1', role: 'reviewer' as const },
      ],
      sponsors: ['human:sponsor-1'],
    } },
  }) };
}

function projection() {
  const profileDigest = digest({
    revisionId: 'profile-1', projectId: 'project-1', charterRevisionId: 'charter-1',
    packRefs: [], tools: [], skills: [], agents: [
      { id: 'executor-1', digest: SHA('1'), role: 'executor', allowedTools: [], allowedSkills: [] },
      { id: 'reviewer-1', digest: SHA('2'), role: 'reviewer', allowedTools: [], allowedSkills: [] },
    ], workflows: [], memories: [], glossaries: [],
  });
  return createWorkroomGovernedAcceptanceProjection({
    version: 1, projectId: 'project-1', profileRevisionId: 'profile-1', profileDigest,
    revision: 1, issuer: 'profile-governance', tasks: [{
      taskKey: 'build', kind: 'task_result',
      criteria: [{ id: 'tests', kind: 'deterministic', description: 'Tests pass' }],
      requiredEvidence: [], minimumRoute: 'baseline', reviewerPrincipalId: 'reviewer-1',
      sponsorPrincipalId: 'human:sponsor-1', reviewerTimeoutMs: 10_000, sponsorTimeoutMs: 20_000,
    }],
    memorySchema: { revision: 1, claimRules: [] },
  });
}

function headers() {
  const base = {
    version: 1 as const, issuer: 'kernel', policyRevision: 1,
    scope: {
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
      candidateHash: SHA('4'),
    },
    dimensions: {
      sideEffect: 'none' as const, reversibility: 'discard_only' as const,
      dataClass: 'internal' as const, blastRadius: 'single_artifact' as const,
      capabilityTags: [], uncertainty: 'known' as const,
    },
  };
  return [
    createWorkroomKernelRiskHeader({
      ...base, sourceType: 'workflow-plan', sourceRef: 'plan:1', sourceRevision: 1,
      sourceContentDigest: SHA('7'),
    }),
    createWorkroomKernelRiskHeader({
      ...base, sourceType: 'capability-snapshot', sourceRef: 'capability:1',
      sourceContentDigest: SHA('8'),
    }),
  ];
}

function report() {
  return {
    ref: 'workroom-report:1', candidateHash: SHA('4'), projectId: 'project-1', runId: 'run-1',
    planRef: 'plan:1', planRevision: 1, taskKey: 'build', taskRevision: 1, claims: [],
  };
}

function runState() {
  return {
    projectId: 'project-1', runId: 'run-1', title: 'Run', status: 'active' as const,
    sequence: 0, now: 1, cancelRequested: false, tasks: {}, assignments: {},
    reviewerAssignments: {}, sponsorGates: {},
  };
}

function effectIntent() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'publish', taskRevision: 1,
    candidateHash: SHA('4'), capability: { ref: 'capability:publish', digest: SHA('1') },
    operation: { kind: 'git_open_pr' as const, parameters: {
      repositoryId: 'owner/repo', headRef: 'refs/heads/work', baseRef: 'refs/heads/main',
      headSha: '2'.repeat(40),
    } },
    target: { ref: 'workspace:owner/repo', digest: SHA('3') }, preconditions: [],
    risk: { assessmentRef: 'risk:publish', assessmentDigest: SHA('5'), tier: 'high' as const },
    reversibility: { kind: 'compensatable' as const, compensation: {
      operation: 'close_pr', requiresReceipt: true as const,
    } },
    idempotencyKey: 'effect:publish:1', createdAt: 1,
  };
}
