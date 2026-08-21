import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CatalogWorkroomAcceptancePrincipalRegistry,
  DurableWorkroomContextReleaseConsumer,
  EffectLedgerWorkroomAcceptanceState,
  KernelHeaderWorkroomRiskFacts,
  ProfileOwnedWorkroomAcceptanceProvider,
  TypedWorkroomAcceptanceCheckRunner,
  createWorkroomGovernedAcceptanceProjection,
  createWorkroomKernelRiskHeader,
} from '../../src/plugin-runtime/workroom-acceptance-provider-composition.js';
import { PinnedWorkroomAcceptancePolicy } from '../../src/plugin-runtime/workroom-risk-acceptance-runtime.js';
import {
  MemoryProjectProfileJournal,
  ProjectProfileRegistry,
} from '../../src/workroom/profile-registry.js';
import {
  MemoryWorkroomEffectJournal,
  WorkroomEffectLedger,
  createWorkroomEffectIntent,
} from '../../src/workroom/effect-ledger.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { WorkroomAcceptanceDecisionInput } from '../../src/workroom/acceptance-policy.js';
import type { WorkroomCatalogSnapshot } from '../../src/workroom/catalog.js';

const SHA = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

describe('P7 governed Acceptance production providers', () => {
  it('derives low-risk Acceptance and Memory Schema only from the exact governed Run Profile', async () => {
    const fixture = await profileFixture();
    const projection = acceptanceProjection(fixture.profileDigest);
    const provider = new ProfileOwnedWorkroomAcceptanceProvider({
      profiles: fixture.profiles,
      catalog: fixture.catalog,
      projections: { resolve: async () => projection },
    });

    const facts = await provider.resolve({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    });
    expect(facts).toMatchObject({
      profileRef: 'profile:project-1:profile-1',
      profileDigest: fixture.profileDigest,
      kind: 'task_result',
      reviewerOwner: 'reviewer-1',
      sponsorOwner: 'human:sponsor-1',
      minimumRoute: 'baseline',
    });
    const schema = await provider.resolveMemorySchema({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      acceptance: acceptanceRecord(facts.policy),
    });
    expect(schema.claimRules).toEqual([{
      key: 'build.result', valueType: 'string', allowedStatuses: ['verified'], allowSupersedes: false,
    }]);

    const stale = createWorkroomGovernedAcceptanceProjection({
      ...projection, profileDigest: SHA('9'),
    });
    const staleProvider = new ProfileOwnedWorkroomAcceptanceProvider({
      profiles: fixture.profiles,
      catalog: fixture.catalog,
      projections: { resolve: async () => stale },
    });
    await expect(staleProvider.resolve({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    })).rejects.toThrow(/Profile.*digest|projection.*drift/iu);
  });

  it('uses Kernel headers only, binds their hashes, and routes reviewer/sponsor without report risk metadata', async () => {
    const fixture = await profileFixture();
    const profile = new ProfileOwnedWorkroomAcceptanceProvider({
      profiles: fixture.profiles,
      catalog: fixture.catalog,
      projections: { resolve: async () => acceptanceProjection(fixture.profileDigest) },
    });
    let high = false;
    const headers = () => [
      riskHeader('workflow-plan', 'plan:run-1:1', high ? {
        sideEffect: 'external', reversibility: 'compensatable', dataClass: 'internal',
        blastRadius: 'external', capabilityTags: ['publish'], uncertainty: 'known',
      } : lowRisk()),
      riskHeader('capability-snapshot', 'capability:assignment-1:1', lowRisk()),
      riskHeader('artifact-header', 'artifact:change-set', lowRisk()),
    ];
    const risk = new KernelHeaderWorkroomRiskFacts({ headers: { resolve: async () => headers() } });
    const checks = new TypedWorkroomAcceptanceCheckRunner({
      checks: [{
        id: 'tests', runner: 'typed-ci', version: '1',
        run: async input => ({ status: 'passed' as const, evidenceRefs: input.evidenceRefs }),
      }],
    });
    const policy = new PinnedWorkroomAcceptancePolicy({
      policies: profile,
      reports: { read: async () => report({ risk: 'executor-says-low' }) },
      risk,
      checks,
    });
    const contract = await policy.pinContract(pinInput('build'));
    const low = await policy.decide(decisionInput(contract));
    expect(low).toMatchObject({ disposition: 'accepted', route: 'auto_accept' });

    high = true;
    const sponsor = await policy.decide(decisionInput(contract));
    expect(sponsor).toMatchObject({
      disposition: 'policy_blocked', route: 'sponsor_required',
      riskAssessment: { tier: 'high' }, wait: { owner: 'human:sponsor-1' },
    });

    const judgmentProjection = acceptanceProjection(fixture.profileDigest, 'judgment');
    const reviewerPolicy = new PinnedWorkroomAcceptancePolicy({
      policies: new ProfileOwnedWorkroomAcceptanceProvider({
        profiles: fixture.profiles, catalog: fixture.catalog,
        projections: { resolve: async () => judgmentProjection },
      }),
      reports: { read: async () => report() },
      risk: new KernelHeaderWorkroomRiskFacts({
        headers: { resolve: async () => [
          riskHeader('workflow-plan', 'plan:run-1:1', lowRisk()),
          riskHeader('capability-snapshot', 'capability:assignment-1:1', lowRisk()),
          riskHeader('artifact-header', 'artifact:change-set', lowRisk()),
        ] },
      }),
      checks,
    });
    const judgmentContract = await reviewerPolicy.pinContract(pinInput('build'));
    await expect(reviewerPolicy.decide(decisionInput(judgmentContract))).resolves.toMatchObject({
      disposition: 'policy_blocked', route: 'reviewer_required', wait: { owner: 'reviewer-1' },
    });
  });

  it('rejects stale Kernel header digests and missing typed checks instead of trusting Executor metadata', async () => {
    const staleHeader = { ...riskHeader('workflow-plan', 'plan:run-1:1', lowRisk()), digest: SHA('f') };
    const risk = new KernelHeaderWorkroomRiskFacts({
      headers: { resolve: async () => [staleHeader] },
    });
    await expect(risk.assess(riskInput())).rejects.toThrow(/header digest mismatch/iu);

    const checks = new TypedWorkroomAcceptanceCheckRunner({ checks: [] });
    await expect(checks.run(checkInput())).rejects.toThrow(/typed check.*unavailable/iu);

    const fixture = await profileFixture();
    const forged = new PinnedWorkroomAcceptancePolicy({
      policies: new ProfileOwnedWorkroomAcceptanceProvider({
        profiles: fixture.profiles, catalog: fixture.catalog,
        projections: { resolve: async () => acceptanceProjection(fixture.profileDigest) },
      }),
      reports: { read: async () => report({ risk: 'low' }) },
      risk: { assess: async input => ({
        candidateHash: input.candidateHash,
        facts: lowRisk(),
        sources: [{
          sourceType: 'report-header', sourceRef: input.reportRef, sourceDigest: input.reportDigest,
          issuer: 'executor-report', policyRevision: input.policy.revision,
        }],
      }) },
      checks: new TypedWorkroomAcceptanceCheckRunner({
        checks: [{
          id: 'tests', runner: 'typed-ci', version: '1',
          run: async () => ({ status: 'passed', evidenceRefs: [] }),
        }],
      }),
    });
    const contract = await forged.pinContract(pinInput('build'));
    await expect(forged.decide(decisionInput(contract))).rejects.toThrow(/Report metadata/iu);
  });

  it('resolves Reviewer and Sponsor only from exact persistent Catalog revision and pinned Profile intersection', async () => {
    const fixture = await profileFixture();
    const principals = new CatalogWorkroomAcceptancePrincipalRegistry({
      profiles: fixture.profiles,
      catalog: fixture.catalog,
    });
    await expect(principals.resolve({
      projectId: 'project-1', runId: 'run-1', principalId: 'reviewer-1',
    })).resolves.toMatchObject({
      roles: ['reviewer'], catalogRevision: fixture.catalogSnapshot.revision,
      projectDigest: digest(fixture.catalogSnapshot.definitions['project-1']),
      profileDigest: fixture.profileDigest,
    });
    await expect(principals.resolve({
      projectId: 'project-1', runId: 'run-1', principalId: 'human:sponsor-1',
    })).resolves.toMatchObject({ roles: ['sponsor'] });
    await expect(principals.resolve({
      projectId: 'project-1', runId: 'run-1', principalId: 'executor-1',
    })).resolves.toMatchObject({ roles: ['executor'] });
    await expect(principals.resolve({
      projectId: 'project-1', runId: 'run-1', principalId: 'model:claimed-sponsor',
    })).resolves.toBeNull();
  });

  it('treats Effect authorization, commit, and outcome_unknown as distinct trusted Ledger states', async () => {
    const journal = new MemoryWorkroomEffectJournal();
    const ledger = new WorkroomEffectLedger(journal, {
      authorize: async ({ intent }) => ({
        version: 1, authorized: true, intentId: intent.id, intentDigest: intent.digest,
        candidateHash: intent.candidateHash, authorizationId: 'authorization-1',
        authorizationDigest: SHA('a'), policy: { id: 'effect-policy', revision: 1, digest: SHA('b') },
        authorizedBy: 'p7-sponsor:human:sponsor-1', expiresAt: 10_000,
      }),
    });
    const intent = createWorkroomEffectIntent({
      projectId: 'project-1', runId: 'run-1', taskKey: 'publish', taskRevision: 1,
      candidateHash: SHA('4'), capability: { ref: 'capability:publish', digest: SHA('1') },
      operation: { kind: 'git_open_pr', parameters: {
        repositoryId: 'owner/repo', headRef: 'refs/heads/work', baseRef: 'refs/heads/main', headSha: '2'.repeat(40),
      } },
      target: { ref: 'workspace:owner/repo', digest: SHA('3') }, preconditions: [],
      risk: { assessmentRef: 'risk:publish', assessmentDigest: SHA('5'), tier: 'high' },
      reversibility: { kind: 'compensatable', compensation: { operation: 'close_pr', requiresReceipt: true } },
      idempotencyKey: 'effect:publish:1', createdAt: 1,
    });
    await ledger.recordIntent('project-1', intent);
    const effects = new EffectLedgerWorkroomAcceptanceState({ journal });
    await expect(effects.resolve(effectQuery())).resolves.toMatchObject({ state: 'pending_authorization' });
    const policy = effectAcceptancePolicy(effects, intent.id);
    const contract = await policy.pinContract(pinInput('publish'));
    await expect(policy.decide(effectDecisionInput(contract))).resolves.toMatchObject({
      disposition: 'policy_blocked', route: 'policy_blocked',
      reason: expect.stringContaining('pending_authorization'),
    });
    const executing = await ledger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'effect-operation-1', workerId: 'effect-worker-1', fence: 1, startedAt: 2,
    });
    await expect(effects.resolve(effectQuery())).resolves.toMatchObject({
      state: 'authorized', authorizationDigest: executing.authorization?.authorizationDigest,
    });
    await expect(policy.decide(effectDecisionInput(contract))).resolves.toMatchObject({
      disposition: 'policy_blocked', route: 'policy_blocked',
      reason: expect.stringContaining('authorized'),
    });
    await ledger.recordReceipt('project-1', intent.id, effectReceipt(executing, 'outcome_unknown'));
    await expect(effects.resolve(effectQuery())).resolves.toMatchObject({ state: 'outcome_unknown' });
    await expect(policy.decide(effectDecisionInput(contract))).resolves.toMatchObject({
      disposition: 'policy_blocked', route: 'policy_blocked',
      reason: expect.stringContaining('requires reconciliation'),
    });

    const committedJournal = new MemoryWorkroomEffectJournal();
    const committedLedger = new WorkroomEffectLedger(committedJournal, ledger.authorization);
    await committedLedger.recordIntent('project-1', intent);
    const attempt = await committedLedger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'effect-operation-1', workerId: 'effect-worker-1', fence: 1, startedAt: 2,
    });
    await committedLedger.recordReceipt('project-1', intent.id, effectReceipt(attempt, 'committed'));
    const committedEffects = new EffectLedgerWorkroomAcceptanceState({ journal: committedJournal });
    await expect(committedEffects.resolve(effectQuery()))
      .resolves.toMatchObject({ state: 'committed', receiptDigest: SHA('e') });
    await expect(effectAcceptancePolicy(committedEffects, intent.id).decide(effectDecisionInput(contract)))
      .resolves.toMatchObject({
        disposition: 'policy_blocked', route: 'sponsor_required',
        riskAssessment: { tier: 'high' },
      });
  });

  it('replays one Context Release operation idempotently after restart and never caches unknown as released', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-context-release-consumer-'));
    const release = vi.fn(async () => ({ status: 'released' as const, receiptRef: 'context-release:receipt:1' }));
    const request = contextReleaseRequest();
    const first = new DurableWorkroomContextReleaseConsumer({ directory, consumer: { release } });
    const receipt = await first.release(request);
    expect(receipt).toMatchObject({ status: 'released', operationId: request.operationId });
    const restarted = new DurableWorkroomContextReleaseConsumer({ directory, consumer: { release } });
    expect(await restarted.release(request)).toEqual(receipt);
    expect(release).toHaveBeenCalledTimes(1);

    const unknownDirectory = await mkdtemp(join(tmpdir(), 'zhin-context-release-unknown-'));
    const uncertain = vi.fn()
      .mockResolvedValueOnce({ status: 'outcome_unknown' as const, receiptRef: 'context-release:unknown:1' })
      .mockResolvedValueOnce({ status: 'released' as const, receiptRef: 'context-release:receipt:2' });
    const uncertainConsumer = new DurableWorkroomContextReleaseConsumer({
      directory: unknownDirectory, consumer: { release: uncertain },
    });
    expect((await uncertainConsumer.release(request)).status).toBe('outcome_unknown');
    expect((await new DurableWorkroomContextReleaseConsumer({
      directory: unknownDirectory, consumer: { release: uncertain },
    }).release(request)).status).toBe('released');
    expect(uncertain).toHaveBeenCalledTimes(2);
  });
});

async function profileFixture() {
  const profiles = new ProjectProfileRegistry(new MemoryProjectProfileJournal(), {
    authorize: async input => ({
      ...input, approved: true, decisionId: 'profile-decision-1', route: 'sponsor',
      outcome: 'approved', decidedBy: 'human:sponsor-1',
    }),
  });
  const profileProjection = {
    revisionId: 'profile-1', projectId: 'project-1', charterRevisionId: 'charter-1',
    packRefs: [{ id: 'policy:acceptance', version: '1.0.0', digest: SHA('a') }],
    tools: [], skills: [],
    agents: [
      { id: 'executor-1', digest: SHA('1'), role: 'executor', allowedTools: [], allowedSkills: [] },
      { id: 'reviewer-1', digest: SHA('2'), role: 'reviewer', allowedTools: [], allowedSkills: [] },
    ],
    workflows: [], memories: [], glossaries: [], acceptancePolicies: [],
  } as const;
  const profileDigest = digest(profileProjection);
  await profiles.registerRevision({
    projectId: 'project-1', expectedRegistryRevision: -1,
    revision: {
      revisionId: 'profile-1', projectId: 'project-1', charterRevisionId: 'charter-1',
      packRefs: profileProjection.packRefs, overlayDigest: SHA('3'), compiledDigest: profileDigest,
      compiledProfile: { ...profileProjection, digest: profileDigest },
      source: { kind: 'sponsor_decision', sourceId: 'profile-decision-1' },
    },
  });
  await profiles.activateRevision({
    projectId: 'project-1', expectedRegistryRevision: 0,
    revisionId: 'profile-1', compiledDigest: profileDigest,
  });
  await profiles.pinRun({ projectId: 'project-1', runId: 'run-1', expectedRegistryRevision: 1 });
  const catalogSnapshot: WorkroomCatalogSnapshot = Object.freeze({
    revision: SHA('c').slice('sha256:'.length),
    definitions: Object.freeze({
      'project-1': Object.freeze({
        name: 'Project One', enabled: true,
        members: Object.freeze([
          Object.freeze({ agent: 'orchestrator-1', role: 'orchestrator' as const }),
          Object.freeze({ agent: 'executor-1', role: 'executor' as const }),
          Object.freeze({ agent: 'reviewer-1', role: 'reviewer' as const }),
        ]),
        sponsors: Object.freeze(['human:sponsor-1']),
      }),
    }),
  });
  const catalog = { read: async () => catalogSnapshot };
  return { profiles, profileDigest, catalog, catalogSnapshot };
}

function acceptanceProjection(profileDigest: string, criterionKind: 'deterministic' | 'judgment' = 'deterministic') {
  return createWorkroomGovernedAcceptanceProjection({
    version: 1, projectId: 'project-1', profileRevisionId: 'profile-1', profileDigest,
    revision: 1, issuer: 'profile-governance:profile-decision-1',
    tasks: [{
      taskKey: 'build', kind: 'task_result',
      criteria: [{ id: 'tests', kind: criterionKind, description: 'Typed tests pass' }],
      requiredEvidence: ['workroom-evidence:test'], minimumRoute: 'baseline',
      reviewerPrincipalId: 'reviewer-1', sponsorPrincipalId: 'human:sponsor-1',
      reviewerTimeoutMs: 10_000, sponsorTimeoutMs: 20_000,
    }],
    memorySchema: {
      revision: 1,
      claimRules: [{
        key: 'build.result', valueType: 'string', allowedStatuses: ['verified'], allowSupersedes: false,
      }],
    },
  });
}

function riskHeader(
  sourceType: 'workflow-plan' | 'capability-snapshot' | 'artifact-header' | 'effect-intent',
  sourceRef: string,
  dimensions: ReturnType<typeof lowRisk>,
) {
  return createWorkroomKernelRiskHeader({
    version: 1, sourceType, sourceRef, sourceContentDigest: digest(sourceType),
    ...(sourceType === 'workflow-plan' ? { sourceRevision: 1 } : {}),
    issuer: 'workroom-kernel-projector', policyRevision: 1,
    scope: {
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
      candidateHash: SHA('4'),
    },
    dimensions,
  });
}

function lowRisk() {
  return {
    sideEffect: 'none' as const, reversibility: 'discard_only' as const,
    dataClass: 'internal' as const, blastRadius: 'single_artifact' as const,
    capabilityTags: [] as readonly string[], uncertainty: 'known' as const,
  };
}

function pinInput(taskKey: string) {
  return {
    projectId: 'project-1', runId: 'run-1', expectedSequence: 1, now: 1,
    task: { key: taskKey, title: 'Build', revision: 1 },
  };
}

function decisionInput(contract: Awaited<ReturnType<PinnedWorkroomAcceptancePolicy['pinContract']>>): WorkroomAcceptanceDecisionInput {
  return {
    projectId: 'project-1', runId: 'run-1', expectedSequence: 10, now: 1_000,
    contract,
    task: { key: 'build', revision: 1, reportRef: 'workroom-report:1' },
    assignment: {
      id: 'assignment-1', owner: 'executor-1', reportRef: 'workroom-report:1',
      reportDigest: SHA('6'), candidateRef: 'candidate:1', candidateHash: SHA('4'),
    },
  };
}

function report(metadata: Record<string, unknown> = {}) {
  return {
    ref: 'workroom-report:1', candidateHash: SHA('4'), projectId: 'project-1', runId: 'run-1',
    planRef: 'plan:run-1:1', planRevision: 1, taskKey: 'build', taskRevision: 1,
    claims: [{
      id: 'claim-1', key: 'build.result', value: 'passed', status: 'verified' as const,
      evidenceRefs: ['workroom-evidence:test'], artifactRefs: ['artifact:change-set'],
    }],
    metadata,
  };
}

function riskInput() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    candidateHash: SHA('4'), reportRef: 'workroom-report:1', reportDigest: SHA('6'),
    artifactRefs: ['artifact:change-set'], planRef: 'plan:run-1:1', planRevision: 1,
    policy: { id: 'acceptance-policy', revision: 1, digest: SHA('7') },
  };
}

function checkInput() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'build',
    criterion: { id: 'tests', kind: 'deterministic' as const, description: 'Typed tests pass' },
    candidateHash: SHA('4'), reportRef: 'workroom-report:1', evidenceRefs: ['workroom-evidence:test'],
    policy: { id: 'acceptance-policy', revision: 1, digest: SHA('7') },
  };
}

function acceptanceRecord(policy: Readonly<{ id: string; revision: number; digest: string }>) {
  const contract = {
    id: 'contract:build', revision: 1, digest: SHA('8'), taskKey: 'build', taskRevision: 1,
    kind: 'task_result' as const, policy,
    criteria: [{ id: 'tests', kind: 'deterministic' as const, description: 'Typed tests pass' }],
    requiredEvidence: ['workroom-evidence:test'],
  };
  return {
    version: 1 as const, id: 'acceptance:build', sourceSequence: 10, acceptanceSequence: 11,
    candidateHash: SHA('4'), contractId: contract.id, policy,
    disposition: 'accepted' as const, route: 'auto_accept' as const,
    candidate: {
      id: 'candidate:1', taskKey: 'build', taskRevision: 1, producerAssignmentId: 'assignment-1',
      producerPrincipalId: 'executor-1', reportRef: 'workroom-report:1', hash: SHA('4'),
      claimIds: ['claim-1'], evidenceRefs: ['workroom-evidence:test'],
    },
    contract,
    riskAssessment: {
      id: 'risk:1', candidateHash: SHA('4'), tier: 'low' as const, factsHash: SHA('9'),
      assessor: 'kernel-risk-lattice:1', sourceRefs: ['plan:run-1:1'],
    },
    checkResults: [], acceptedClaimIds: ['claim-1'], rejectedClaimIds: [], decidedBy: 'policy',
  };
}

function effectQuery() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'publish', taskRevision: 1,
    candidateHash: SHA('4'),
  };
}

function effectAcceptancePolicy(effects: EffectLedgerWorkroomAcceptanceState, intentRef: string) {
  return new PinnedWorkroomAcceptancePolicy({
    policies: {
      resolve: async input => ({
        profileRef: `profile:${input.projectId}:profile-1`, profileDigest: SHA('1'),
        policy: { id: 'effect-acceptance-policy', revision: 1, digest: SHA('2') },
        kind: 'effect_intent',
        criteria: [{ id: 'effect-receipt', kind: 'deterministic', description: 'Effect receipt is typed' }],
        requiredEvidence: [], minimumRoute: 'baseline', reviewerOwner: 'reviewer-1',
        sponsorOwner: 'human:sponsor-1', reviewerTimeoutMs: 10_000, sponsorTimeoutMs: 20_000,
        binding: {
          sourceType: 'project-profile', sourceRef: `profile:${input.projectId}:profile-1`,
          sourceDigest: SHA('1'), issuer: 'profile-governance', policyRevision: 1,
        },
      }),
    },
    reports: { read: async () => ({
      ref: 'workroom-report:publish', candidateHash: SHA('4'), projectId: 'project-1', runId: 'run-1',
      planRef: 'plan:run-1:1', planRevision: 1, taskKey: 'publish', taskRevision: 1,
      claims: [{
        id: 'claim-effect', key: 'publish.result', value: 'committed', status: 'verified',
        evidenceRefs: [], artifactRefs: ['artifact:pr'],
      }],
    }) },
    risk: new KernelHeaderWorkroomRiskFacts({
      headers: { resolve: async () => [
        effectRiskHeader('workflow-plan', 'plan:run-1:1'),
        effectRiskHeader('capability-snapshot', 'capability:publish:1'),
        effectRiskHeader('artifact-header', 'artifact:pr'),
        effectRiskHeader('effect-intent', intentRef),
      ] },
    }),
    checks: new TypedWorkroomAcceptanceCheckRunner({
      checks: [{
        id: 'effect-receipt', runner: 'effect-ledger-check', version: '1',
        run: async () => ({ status: 'passed', evidenceRefs: [] }),
      }],
    }),
    effects,
  });
}

function effectRiskHeader(
  sourceType: 'workflow-plan' | 'capability-snapshot' | 'artifact-header' | 'effect-intent',
  sourceRef: string,
) {
  return createWorkroomKernelRiskHeader({
    version: 1, sourceType, sourceRef, sourceContentDigest: digest({ sourceType, sourceRef }),
    ...(sourceType === 'workflow-plan' ? { sourceRevision: 1 } : {}),
    issuer: 'workroom-kernel-projector', policyRevision: 1,
    scope: {
      projectId: 'project-1', runId: 'run-1', taskKey: 'publish', taskRevision: 1,
      candidateHash: SHA('4'),
    },
    dimensions: {
      sideEffect: sourceType === 'effect-intent' ? 'external' : 'none',
      reversibility: sourceType === 'effect-intent' ? 'compensatable' : 'discard_only',
      dataClass: 'internal', blastRadius: sourceType === 'effect-intent' ? 'external' : 'single_artifact',
      capabilityTags: sourceType === 'effect-intent' ? ['publish'] : [], uncertainty: 'known',
    },
  });
}

function effectDecisionInput(
  contract: Awaited<ReturnType<PinnedWorkroomAcceptancePolicy['pinContract']>>,
): WorkroomAcceptanceDecisionInput {
  return {
    projectId: 'project-1', runId: 'run-1', expectedSequence: 10, now: 1_000,
    contract,
    task: { key: 'publish', revision: 1, reportRef: 'workroom-report:publish' },
    assignment: {
      id: 'assignment-publish', owner: 'executor-1', reportRef: 'workroom-report:publish',
      reportDigest: SHA('6'), candidateRef: 'candidate:publish', candidateHash: SHA('4'),
    },
  };
}

function effectReceipt(
  state: Awaited<ReturnType<WorkroomEffectLedger['startAuthorizedAttempt']>>,
  outcome: 'committed' | 'outcome_unknown',
) {
  return {
    version: 1 as const, receiptId: `receipt:${outcome}`, intentId: state.intent.id,
    intentDigest: state.intent.digest, authorizationDigest: state.authorization!.authorizationDigest,
    attemptId: state.attempt!.id, fence: state.attempt!.fence,
    provider: { id: 'github', digest: SHA('d') }, outcome,
    remoteRef: 'github:pr:1', remoteDigest: SHA('e'), observedAt: 3, authenticatedBy: 'github-app',
  };
}

function contextReleaseRequest() {
  const eligibility = {
    eligible: true as const, ref: 'context-release:build',
    projectId: 'project-1', runId: 'run-1', taskKey: 'build',
    sourceAcceptanceId: 'acceptance:build', sourceHash: SHA('b'),
    taskMemoryId: 'task-memory:build', statePatchId: 'state-patch:build', stateRevision: 1,
  };
  return { operationId: `context-release-operation:${digest(eligibility)}`, eligibility };
}
