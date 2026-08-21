import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FileWorkroomAcceptanceProjectionRepository,
  FileWorkroomKernelRiskHeaderRepository,
  type WorkroomAcceptanceProjectionPayloadPort,
} from '../../src/plugin-runtime/workroom-acceptance-fact-providers.js';
import {
  createGenerationRemoteContextReleaseCapability,
  PinnedProfileWorkroomAcceptanceProjectionSource,
  WorkroomAcceptanceProfileProjectionRuntime,
  WorkroomArtifactRiskHeaderResolver,
  WorkroomAuthenticatedArtifactRiskProducer,
} from '../../src/plugin-runtime/workroom-acceptance-internal-providers.js';
import { compileWorkroomProfile, type CapabilityPack } from '../../src/workroom/profile-compiler.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import {
  MemoryWorkroomEffectJournal,
  WorkroomEffectLedger,
  createWorkroomEffectIntent,
} from '../../src/workroom/effect-ledger.js';
import { createWorkroomStructuredTaskReport } from '../../src/workroom/workroom-task-report-store.js';

describe('P10 -> P7 internal Acceptance providers', () => {
  it('publishes only the active Profile policy and keeps an immutable pinned Run authorized after HMR/restart', async () => {
    const state = profileState();
    const profiles = { read: vi.fn(async () => state.current) };
    const catalog = { read: vi.fn(async () => ({
      revision: 'c'.repeat(64),
      definitions: { 'project-1': {
        name: 'Project One', enabled: true,
        members: [{ agent: 'reviewer-1', role: 'reviewer' as const }],
        sponsors: ['human:sponsor-1'],
      } },
    })) };
    const source = new PinnedProfileWorkroomAcceptanceProjectionSource({ profiles, catalog });
    const payloads = memoryPayloads();
    const directory = await mkdtemp(join(tmpdir(), 'zhin-profile-acceptance-'));
    const repository = new FileWorkroomAcceptanceProjectionRepository({
      directory, payloads, authority: source,
    });
    const worker = new WorkroomAcceptanceProfileProjectionRuntime({
      source, repository, projects: { listProjectIds: async () => ['project-1'] },
      signal: new AbortController().signal,
    });

    expect(await worker.drain()).toBe(1);
    const first = (await source.list('project-1'))[0]!;
    await expect(repository.resolve({
      projectId: 'project-1', profileRevisionId: 'profile-1',
      profileDigest: state.profile1.digest,
    })).resolves.toEqual(first.projection);

    state.activateSecondProfileWithoutPin();
    expect(await source.list('project-1')).toEqual([]);
    const restarted = new FileWorkroomAcceptanceProjectionRepository({
      directory, payloads, authority: new PinnedProfileWorkroomAcceptanceProjectionSource({ profiles, catalog }),
    });
    await expect(restarted.resolve({
      projectId: 'project-1', profileRevisionId: 'profile-1',
      profileDigest: state.profile1.digest,
    })).resolves.toEqual(first.projection);

    state.dropOldRunPin();
    await expect(restarted.resolve({
      projectId: 'project-1', profileRevisionId: 'profile-1',
      profileDigest: state.profile1.digest,
    })).rejects.toThrow('no longer authorized');
  });

  it('derives content-free Artifact risk only from an authenticated Report and committed Git Effect receipt', async () => {
    const journal = new MemoryWorkroomEffectJournal();
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:1', planRevision: 1,
      taskKey: 'build', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 1,
      claims: [{ label: 'claim-1', key: 'build.result', value: 'private result body',
        status: 'verified', evidenceRefs: ['evidence:ci'], artifactRefs: ['artifact:git:1'] }],
    });
    await committedGitEffect(journal, report.candidateHash);
    const producer = new WorkroomAuthenticatedArtifactRiskProducer({
      generation: 7, effectJournal: journal,
      reports: { read: async () => report },
    });
    const directory = await mkdtemp(join(tmpdir(), 'zhin-artifact-risk-'));
    const repository = new FileWorkroomKernelRiskHeaderRepository({
      directory, generation: 7, authority: producer,
    });
    const resolver = new WorkroomArtifactRiskHeaderResolver({ repository, producer });
    const request = {
      projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
      candidateHash: report.candidateHash, reportRef: report.ref, reportDigest: report.digest,
      planRef: 'plan:1', planRevision: 1, artifactRefs: ['artifact:git:1'], policyRevision: 1,
    };
    await expect(resolver.resolve(request)).resolves.toEqual([
      expect.objectContaining({
        sourceType: 'artifact-header', sourceRef: 'artifact:git:1',
        dimensions: expect.objectContaining({
          sideEffect: 'external', dataClass: 'restricted', uncertainty: 'unknown',
        }),
      }),
    ]);
    const disk = await readFile(join(directory, (await readdir(directory))[0]!), 'utf8');
    expect(disk).not.toContain('private result body');

    const stale = new WorkroomAuthenticatedArtifactRiskProducer({
      generation: 7, effectJournal: new MemoryWorkroomEffectJournal(),
      reports: { read: async () => report },
    });
    await expect(stale.publications(request)).rejects.toThrow('committed Git Effect receipt');

    const noArtifactReports = { read: vi.fn(async () => undefined) };
    const noArtifacts = new WorkroomArtifactRiskHeaderResolver({
      repository,
      producer: new WorkroomAuthenticatedArtifactRiskProducer({
        generation: 7, effectJournal: new MemoryWorkroomEffectJournal(), reports: noArtifactReports,
      }),
    });
    await expect(noArtifacts.resolve({ ...request, artifactRefs: [] })).resolves.toEqual([]);
    expect(noArtifactReports.read).not.toHaveBeenCalled();
  });

  it('accepts only an exact authenticated A2A Context receipt and keeps missing capability unknown', async () => {
    const request = {
      operationId: 'context-release:1',
      eligibility: {
        eligible: true as const, ref: 'context:eligibility:1', projectId: 'project-1', runId: 'run-1',
        taskKey: 'build', sourceAcceptanceId: 'acceptance-1', sourceHash: digest('acceptance'),
        taskMemoryId: 'memory-1', statePatchId: 'patch-1', stateRevision: 2,
      },
    };
    const route = { kind: 'remote' as const, ref: 'a2a:remote-1', digest: digest('a2a-route') };
    const receiptBody = {
      version: 1 as const, operationId: request.operationId,
      eligibilityDigest: digest(request.eligibility), routeRef: route.ref, routeDigest: route.digest,
      status: 'released' as const, receiptRef: 'a2a-receipt:1', authenticatedBy: 'a2a:remote-1',
    };
    const capability = createGenerationRemoteContextReleaseCapability(() => ({
      release: async () => ({ ...receiptBody, digest: digest(receiptBody) }),
      reconcile: async () => ({ ...receiptBody, digest: digest(receiptBody) }),
    }));
    await expect(capability.release({ request, route }, new AbortController().signal)).resolves.toEqual({
      status: 'released', receiptRef: 'a2a-receipt:1', authenticatedBy: 'a2a:remote-1',
    });

    const missing = createGenerationRemoteContextReleaseCapability(() => undefined);
    await expect(missing.reconcile({ request, route }, new AbortController().signal)).resolves.toEqual({
      status: 'outcome_unknown',
      receiptRef: `remote-context-provider-unavailable:${route.digest}`,
      authenticatedBy: `remote-context-route:${route.digest}`,
    });
    const malformed = createGenerationRemoteContextReleaseCapability(() => ({
      release: async () => ({ ...receiptBody, routeDigest: digest('wrong'), digest: digest(receiptBody) }),
      reconcile: async () => ({ ...receiptBody, routeDigest: digest('wrong'), digest: digest(receiptBody) }),
    }));
    await expect(malformed.release({ request, route }, new AbortController().signal))
      .rejects.toThrow('authority binding drift');
  });
});

function profileState() {
  const profile1 = compiledProfile('profile-1', 'reviewer_required');
  const profile2 = compiledProfile('profile-2', 'sponsor_required');
  const revision = (profile: typeof profile1) => ({
    revisionId: profile.revisionId, projectId: 'project-1', charterRevisionId: 'charter-1',
    packRefs: profile.packRefs, overlayDigest: digest(`overlay:${profile.revisionId}`),
    compiledDigest: profile.digest, compiledProfile: profile,
    source: { kind: 'sponsor_decision' as const, sourceId: `source:${profile.revisionId}` },
    governanceDecision: {} as never,
  });
  const state = {
    current: {
      projectId: 'project-1', registryRevision: 2,
      active: { revisionId: 'profile-1', compiledDigest: profile1.digest, activatedAtRegistryRevision: 1 },
      revisions: { 'profile-1': revision(profile1), 'profile-2': revision(profile2) },
      runPins: { 'run-1': {
        projectId: 'project-1', runId: 'run-1', profileRevisionId: 'profile-1',
        profileDigest: profile1.digest, activationRegistryRevision: 1, pinnedAtRegistryRevision: 2,
      } },
    },
    profile1,
    activateSecondProfileWithoutPin() {
      this.current = {
        ...this.current,
        registryRevision: 3,
        active: { revisionId: 'profile-2', compiledDigest: profile2.digest, activatedAtRegistryRevision: 3 },
      };
    },
    dropOldRunPin() {
      this.current = { ...this.current, runPins: {} };
    },
  };
  return state;
}

function compiledProfile(
  revisionId: string,
  minimumRoute: 'reviewer_required' | 'sponsor_required',
) {
  const pack: CapabilityPack = {
    id: 'policy-pack', version: '1', digest: digest(`pack:${revisionId}`), kind: 'policy',
    tools: [], skills: [], workflows: [], memories: [], glossaries: [],
    agents: [{
      id: 'reviewer-1', digest: digest('reviewer'), role: 'reviewer',
      allowedTools: [], allowedSkills: [],
    }],
    acceptancePolicies: [{
      id: 'project-acceptance', digest: digest(`policy:${revisionId}`),
      tasks: [{
        taskKey: 'build', kind: 'task_result',
        criteria: [{ id: 'tests', kind: 'deterministic', description: 'Tests pass' }],
        requiredEvidence: ['ci'], minimumRoute,
        reviewerPrincipalId: 'reviewer-1', sponsorPrincipalId: 'human:sponsor-1',
        reviewerTimeoutMs: 10_000, sponsorTimeoutMs: 20_000,
      }],
      memorySchema: { revision: 1, claimRules: [{
        key: 'build.result', valueType: 'string', allowedStatuses: ['verified'], allowSupersedes: true,
      }] },
    }],
  };
  const result = compileWorkroomProfile({
    revision: {
      id: revisionId, projectId: 'project-1', charterRevisionId: 'charter-1',
      packs: [{ id: pack.id, version: pack.version, digest: pack.digest }],
      enabledTools: [], enabledSkills: [], enabledAgents: ['reviewer-1'], enabledWorkflows: [],
      enabledAcceptancePolicies: ['project-acceptance'],
    },
    packs: [pack],
    generationSupply: { tools: [], skills: [], agents: [{ id: 'reviewer-1', digest: digest('reviewer') }] },
  });
  if (!result.ok) throw new Error('Profile fixture must compile');
  return result.profile;
}

function memoryPayloads(): WorkroomAcceptanceProjectionPayloadPort {
  const values = new Map<string, unknown>();
  return {
    async write(input) {
      values.set(input.projection.digest, input.projection);
      return {
        vaultObjectId: `vault:${input.projection.digest}`, objectId: `projection:${input.projection.digest}`,
        payloadHash: input.projection.digest, descriptorDigest: digest('descriptor'),
        locationManifestDigest: digest('location'), sourceBindingDigest: input.source.bindingDigest,
        source: { ...input.source, verification: 'verified' }, bytes: 1,
      };
    },
    async read(input) {
      return values.get(input.receipt.payloadHash) as never;
    },
  };
}

async function committedGitEffect(
  journal: MemoryWorkroomEffectJournal,
  candidateHash: string,
): Promise<void> {
  const ledger = new WorkroomEffectLedger(journal, {
    authorize: async input => ({
      version: 1, authorized: true, intentId: input.intent.id,
      intentDigest: input.intent.digest, candidateHash,
      authorizationId: 'authorization:git', authorizationDigest: digest('authorization'),
      policy: { id: 'policy:git', revision: 1, digest: digest('policy') },
      authorizedBy: 'human:sponsor-1', expiresAt: 100,
    }),
  });
  const intent = createWorkroomEffectIntent({
    projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    candidateHash, capability: { ref: 'capability:git', digest: digest('capability') },
    operation: { kind: 'git_push', parameters: {
      repositoryId: 'github:owner/repo', ref: 'refs/heads/zhin/run-1/assignment-1/attempt-1',
      headSha: 'a'.repeat(40), changedPaths: ['src/index.ts'],
    } },
    target: { ref: 'github:owner/repo', digest: digest('target') }, preconditions: [],
    risk: { assessmentRef: 'risk:git', assessmentDigest: digest('risk'), tier: 'high' },
    reversibility: { kind: 'compensatable', compensation: {
      operation: 'delete_branch', requiresReceipt: true,
    } },
    idempotencyKey: 'git:build:1', createdAt: 1,
  });
  await ledger.recordIntent('project-1', intent);
  const state = await ledger.startAuthorizedAttempt('project-1', intent.id, {
    operationId: 'git-attempt-1', workerId: 'git-worker', fence: 1, startedAt: 2,
  });
  await ledger.recordReceipt('project-1', intent.id, {
    version: 1, receiptId: 'git-receipt-1', intentId: intent.id, intentDigest: intent.digest,
    authorizationDigest: state.authorization!.authorizationDigest, attemptId: state.attempt!.id,
    fence: 1, provider: { id: 'github-app', digest: digest('github-app') },
    outcome: 'committed', remoteRef: 'github:owner/repo:refs/heads/attempt-1',
    remoteDigest: digest('git-receipt'), observedAt: 3, authenticatedBy: 'github-app:webhook',
  });
}
