import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FileWorkroomAcceptanceProjectionRepository,
  FileWorkroomKernelRiskHeaderRepository,
  ImmutableWorkroomTypedCheckRegistry,
  WorkroomAcceptanceProjectionWorker,
  FileWorkroomEphemeralContextDisposer,
  createRoutedWorkroomEphemeralContextProvider,
  createWorkroomEphemeralContextProviderReceipt,
  type WorkroomAcceptanceProjectionPayloadPort,
  type WorkroomRiskHeaderProducerAuthorityPort,
} from '../../src/plugin-runtime/workroom-acceptance-fact-providers.js';
import {
  KernelHeaderWorkroomRiskFacts,
  TypedWorkroomAcceptanceCheckRunner,
  createWorkroomGovernedAcceptanceProjection,
  createWorkroomKernelRiskHeader,
} from '../../src/plugin-runtime/workroom-acceptance-provider-composition.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const SHA = (value: string): string => digest(value);

describe('P7 production Acceptance fact providers', () => {
  it('stores only a governed projection header and reauthorizes payload reads after restart', async () => {
    const root = await stateRoot('acceptance-projection');
    const payloads = memoryProjectionPayloads();
    const directory = join(root, 'projections');
    let sourceAuthorized = true;
    const authority = { authorize: async (input: ReturnType<typeof projectionCandidate>) =>
      sourceAuthorized && input.source.issuerDigest === SHA('i') };
    const repository = new FileWorkroomAcceptanceProjectionRepository({ directory, payloads, authority });
    const candidate = projectionCandidate();
    const worker = new WorkroomAcceptanceProjectionWorker({
      repository,
      source: { list: async () => [candidate] },
      authority,
      signal: new AbortController().signal,
    });

    expect(await worker.drain(['project-1'])).toBe(1);
    expect(await worker.drain(['project-1'])).toBe(0);
    const files = await readdir(directory);
    const disk = await readFile(join(directory, files[0]!), 'utf8');
    expect(disk).not.toContain('Tests pass');
    expect(disk).not.toContain('claim.key');

    const restarted = new FileWorkroomAcceptanceProjectionRepository({ directory, payloads, authority });
    await expect(restarted.resolve({
      projectId: 'project-1', profileRevisionId: 'profile-1', profileDigest: SHA('p'),
    })).resolves.toEqual(candidate.projection);
    expect(payloads.read).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'acceptance-policy', projectId: 'project-1',
    }), expect.any(AbortSignal));
    sourceAuthorized = false;
    await expect(restarted.resolve({
      projectId: 'project-1', profileRevisionId: 'profile-1', profileDigest: SHA('p'),
    })).rejects.toThrow('no longer authorized');
  });

  it('accepts only generation-authorized Plan/Capability/Artifact/Effect headers and keeps missing facts conservative', async () => {
    const root = await stateRoot('risk-headers');
    const authority: WorkroomRiskHeaderProducerAuthorityPort = {
      authorize: async input => input.producer.generation === 7
        && input.producer.issuerDigest === SHA('i')
        && input.producer.factDigest === input.header.sourceContentDigest,
    };
    const repository = new FileWorkroomKernelRiskHeaderRepository({
      directory: join(root, 'risk'), generation: 7, authority,
    });
    for (const header of riskHeaders()) {
      await repository.publish({
        producer: {
          generation: 7,
          kind: producerKind(header.sourceType),
          issuer: header.issuer, issuerDigest: SHA('i'),
          factRef: header.sourceRef, factDigest: header.sourceContentDigest,
        },
        header,
      });
    }
    await expect(repository.publish({
      producer: {
        generation: 8, kind: 'kernel-plan', issuer: 'kernel', issuerDigest: SHA('i'),
        factRef: 'plan:1', factDigest: SHA('1'),
      },
      header: riskHeaders()[0]!,
    })).rejects.toThrow('generation');

    const facts = await new KernelHeaderWorkroomRiskFacts({ headers: repository }).assess(riskRequest());
    expect(facts.sources.map(source => source.sourceType)).toEqual([
      'artifact-header', 'capability-snapshot', 'effect-intent', 'workflow-plan',
    ]);
    expect(facts.facts.sideEffect).toBe('external');

    const missingArtifact = new FileWorkroomKernelRiskHeaderRepository({
      directory: join(root, 'risk-missing'), generation: 7, authority,
    });
    for (const header of riskHeaders().filter(value => value.sourceType !== 'artifact-header')) {
      await missingArtifact.publish({
        producer: {
          generation: 7, kind: producerKind(header.sourceType), issuer: header.issuer,
          issuerDigest: SHA('i'), factRef: header.sourceRef, factDigest: header.sourceContentDigest,
        }, header,
      });
    }
    await expect(new KernelHeaderWorkroomRiskFacts({ headers: missingArtifact }).assess(riskRequest()))
      .rejects.toThrow('Artifact headers do not cover');
  });

  it('keeps the typed Check registry immutable and an empty registry visibly unavailable', async () => {
    const empty = new ImmutableWorkroomTypedCheckRegistry([]);
    expect(empty.list()).toEqual([]);
    expect(empty.available).toBe(false);

    const registry = new ImmutableWorkroomTypedCheckRegistry([{
      id: 'tests', runner: 'ci', version: '1',
      run: async () => ({ status: 'passed' as const, evidenceRefs: ['evidence:ci'] }),
    }]);
    const runner = new TypedWorkroomAcceptanceCheckRunner({ checks: registry.list() });
    await expect(runner.run({
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      criterion: { id: 'tests', kind: 'deterministic', description: 'Tests pass' },
      candidateHash: SHA('c'), reportRef: 'report:1', evidenceRefs: [],
      policy: { id: 'policy:1', revision: 1, digest: SHA('p') },
    })).resolves.toMatchObject({ status: 'passed', runner: 'ci', evidenceRefs: ['evidence:ci'] });
    expect(() => new ImmutableWorkroomTypedCheckRegistry([...registry.list(), ...registry.list()]))
      .toThrow('duplicate');
  });

  it('reconciles authenticated local/remote Context release receipts without deleting authority records', async () => {
    const root = await stateRoot('context-disposer');
    const eligibility = releaseEligibility();
    const local = contextProvider('local', 'released');
    const remote = contextProvider('remote', 'outcome_unknown');
    const directory = join(root, 'context');
    const disposer = new FileWorkroomEphemeralContextDisposer({
      directory, providers: [local, remote], signal: new AbortController().signal,
    });
    const request = { operationId: `release:${digest(eligibility)}`, eligibility };
    await expect(disposer.release(request)).resolves.toMatchObject({ status: 'outcome_unknown' });
    remote.outcome = 'released';
    await expect(disposer.release(request)).resolves.toMatchObject({ status: 'released' });
    expect(remote.release).toHaveBeenCalledTimes(1);
    expect(remote.reconcile).toHaveBeenCalledTimes(1);

    const restarted = new FileWorkroomEphemeralContextDisposer({
      directory, providers: [local, remote], signal: new AbortController().signal,
    });
    await expect(restarted.release(request)).resolves.toMatchObject({ status: 'released' });
    expect(local.release).toHaveBeenCalledTimes(1);
    expect(remote.reconcile).toHaveBeenCalledTimes(1);
    expect((await readdir(directory)).some(name => name.endsWith('.intent.json'))).toBe(true);
  });

  it('releases only through the exact owning Context route and blocks a missing remote provider', async () => {
    const eligibility = releaseEligibility();
    let kind: 'local' | 'remote' | undefined = 'local';
    const routes = {
      resolve: vi.fn(async () => kind ? ({ kind, ref: `assignment:${kind}:1`, digest: SHA(kind) }) : undefined),
    };
    const localRelease = vi.fn(async () => ({
      status: 'released' as const, receiptRef: 'local-context:released', authenticatedBy: 'local-generation:7',
    }));
    const local = createRoutedWorkroomEphemeralContextProvider({
      identity: { kind: 'local', id: 'local-generation:7', digest: SHA('local-7') },
      routes,
      capability: { release: localRelease, reconcile: localRelease },
    });
    const remote = createRoutedWorkroomEphemeralContextProvider({
      identity: { kind: 'remote', id: 'remote-generation:7', digest: SHA('remote-7') },
      routes,
    });
    const request = { operationId: `release:${digest(eligibility)}`, eligibility };

    await expect(local.release(request, new AbortController().signal))
      .resolves.toMatchObject({ status: 'released', receiptRef: 'local-context:released' });
    await expect(remote.release(request, new AbortController().signal))
      .resolves.toMatchObject({ status: 'released', receiptRef: expect.stringContaining('not-owned') });
    expect(localRelease).toHaveBeenCalledOnce();

    kind = 'remote';
    await expect(local.release(request, new AbortController().signal))
      .resolves.toMatchObject({ status: 'released', receiptRef: expect.stringContaining('not-owned') });
    await expect(remote.release(request, new AbortController().signal))
      .resolves.toMatchObject({ status: 'outcome_unknown', receiptRef: expect.stringContaining('unavailable') });

    kind = undefined;
    await expect(local.reconcile(request, new AbortController().signal))
      .resolves.toMatchObject({ status: 'outcome_unknown', receiptRef: expect.stringContaining('route-unavailable') });
  });
});

async function stateRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `zhin-${label}-`));
  await mkdir(root, { recursive: true });
  return root;
}

function memoryProjectionPayloads() {
  const values = new Map<string, unknown>();
  const write = vi.fn<WorkroomAcceptanceProjectionPayloadPort['write']>(async input => {
    values.set(input.projection.digest, input.projection);
    return {
      vaultObjectId: `vault:${input.projection.digest}`, objectId: `projection:${input.projection.digest}`,
      payloadHash: input.projection.digest, descriptorDigest: SHA('d'), locationManifestDigest: SHA('l'),
      source: { kind: 'profile-policy' as const, ref: input.source.ref, digest: input.source.digest,
        issuer: input.source.issuer, issuerDigest: input.source.issuerDigest, revision: input.source.revision,
        bindingDigest: input.source.bindingDigest, verification: 'verified' as const },
      sourceBindingDigest: input.source.bindingDigest, bytes: 123,
    };
  });
  const read = vi.fn<WorkroomAcceptanceProjectionPayloadPort['read']>(async input =>
    values.get(input.receipt.payloadHash) as never);
  return { write, read };
}

function projectionCandidate() {
  const projection = createWorkroomGovernedAcceptanceProjection({
    version: 1, projectId: 'project-1', profileRevisionId: 'profile-1', profileDigest: SHA('p'),
    revision: 1, issuer: 'profile-policy:issuer',
    tasks: [{ taskKey: 'build', kind: 'task_result',
      criteria: [{ id: 'tests', kind: 'deterministic', description: 'Tests pass claim.key' }],
      requiredEvidence: ['evidence:ci'], minimumRoute: 'baseline',
      reviewerPrincipalId: 'reviewer', sponsorPrincipalId: 'sponsor',
      reviewerTimeoutMs: 100, sponsorTimeoutMs: 200 }],
    memorySchema: { revision: 1, claimRules: [] },
  });
  return {
    projection,
    source: {
      kind: 'profile-policy' as const, ref: 'profile-policy:1', digest: SHA('s'),
      issuer: 'profile-policy:issuer', issuerDigest: SHA('i'), revision: 1,
    },
  };
}

function riskHeaders() {
  const scope = { projectId: 'project-1', runId: 'run-1', taskKey: 'build',
    taskRevision: 1, candidateHash: SHA('c') };
  const dimensions = { sideEffect: 'none' as const, reversibility: 'discard_only' as const,
    dataClass: 'internal' as const, blastRadius: 'single_artifact' as const,
    capabilityTags: [] as string[], uncertainty: 'known' as const };
  return [
    createWorkroomKernelRiskHeader({ version: 1, sourceType: 'workflow-plan', sourceRef: 'plan:1',
      sourceContentDigest: SHA('1'), sourceRevision: 1, issuer: 'kernel', policyRevision: 1,
      scope, dimensions }),
    createWorkroomKernelRiskHeader({ version: 1, sourceType: 'capability-snapshot', sourceRef: 'capability:1',
      sourceContentDigest: SHA('2'), issuer: 'kernel', policyRevision: 1, scope, dimensions }),
    createWorkroomKernelRiskHeader({ version: 1, sourceType: 'artifact-header', sourceRef: 'artifact:1',
      sourceContentDigest: SHA('3'), issuer: 'workspace', policyRevision: 1, scope, dimensions }),
    createWorkroomKernelRiskHeader({ version: 1, sourceType: 'effect-intent', sourceRef: 'effect:1',
      sourceContentDigest: SHA('4'), issuer: 'effect-ledger', policyRevision: 1, scope,
      dimensions: { ...dimensions, sideEffect: 'external' as const, blastRadius: 'external' as const } }),
  ];
}

function producerKind(source: string) {
  return ({ 'workflow-plan': 'kernel-plan', 'capability-snapshot': 'kernel-capability',
    'artifact-header': 'workspace-artifact', 'effect-intent': 'effect-ledger' } as const)[source as 'workflow-plan'];
}

function riskRequest() {
  return { projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    candidateHash: SHA('c'), reportRef: 'report:1', reportDigest: SHA('r'),
    artifactRefs: ['artifact:1'], planRef: 'plan:1', planRevision: 1,
    policy: { id: 'policy:1', revision: 1, digest: SHA('p') } };
}

function releaseEligibility() {
  return { eligible: true as const, ref: 'context-release:1', projectId: 'project-1', runId: 'run-1',
    taskKey: 'build', sourceAcceptanceId: 'acceptance:1', sourceHash: SHA('s'),
    taskMemoryId: 'memory:1', statePatchId: 'patch:1', stateRevision: 1 };
}

function contextProvider(kind: 'local' | 'remote', initial: 'released' | 'outcome_unknown') {
  const provider = {
    identity: { kind, id: `${kind}:provider`, digest: SHA(kind) },
    outcome: initial,
    release: vi.fn(async input => createWorkroomEphemeralContextProviderReceipt({
      operationId: input.operationId, eligibility: input.eligibility, provider: provider.identity,
      status: provider.outcome, receiptRef: `${kind}:receipt`, authenticatedBy: `${kind}:authority`,
    })),
    reconcile: vi.fn(async input => createWorkroomEphemeralContextProviderReceipt({
      operationId: input.operationId, eligibility: input.eligibility, provider: provider.identity,
      status: provider.outcome, receiptRef: `${kind}:receipt`, authenticatedBy: `${kind}:authority`,
    })),
  };
  return provider;
}
