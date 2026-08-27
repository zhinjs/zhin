import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FileWorkroomProfileAuthorityRepository,
  FileWorkroomRunProfilePinProofRepository,
  WorkroomProfileAuthorityRuntime,
  createWorkroomProfileOverlay,
  type WorkroomProfileAuthorityDecision,
  type WorkroomProfileAuthorityRequest,
} from '../../src/plugin-runtime/workroom-profile-authority-runtime.js';
import {
  createWorkroomDynamicPlanningGenerationSnapshot,
  createWorkroomDynamicPlanningPolicySnapshot,
  type WorkroomDynamicPlanningPolicyRequest,
} from '../../src/plugin-runtime/workroom-dynamic-planning-provider.js';
import { FileProjectProfileJournal } from '../../src/workroom/file-profile-journal.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';
import {
  nodeDurableFileSystem,
  type DurableFileSystem,
} from '../../src/workroom/durable-file-store.js';

const sha = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

const packInput = Object.freeze({
  id: 'pack:engineering',
  version: '1.0.0',
  kind: 'domain' as const,
  tools: Object.freeze([{ id: 'tool:repo', digest: sha('1') }]),
  skills: Object.freeze([{
    id: 'skill:code', digest: sha('2'), requiresTools: Object.freeze(['tool:repo']),
  }]),
  agents: Object.freeze([{
    id: 'agent:lead', digest: sha('3'), role: 'orchestrator',
    allowedTools: Object.freeze(['tool:repo']), allowedSkills: Object.freeze(['skill:code']),
  }]),
  workflows: Object.freeze([{
    id: 'workflow:delivery', digest: sha('4'), requiredByProfile: true,
    tasks: Object.freeze([]),
  }]),
});

function exactAuthority() {
  return Object.freeze({
    authorize: vi.fn(async (request: WorkroomProfileAuthorityRequest): Promise<WorkroomProfileAuthorityDecision> =>
      Object.freeze({
        approved: true as const,
        requestDigest: request.digest,
        decisionId: `decision:${request.operationId}`,
        decidedBy: request.authenticatedPrincipalId,
        authorizedBy: request.action === 'publish_pack' ? 'trusted_pack_publisher' as const : 'sponsor' as const,
        decidedAt: 100,
      })),
    verify: vi.fn(async (
      request: WorkroomProfileAuthorityRequest,
      decision: WorkroomProfileAuthorityDecision,
    ) => decision.requestDigest === request.digest
      && decision.decidedBy === request.authenticatedPrincipalId),
  });
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-profile-authority-'));
  const stateRoot = join(root, '.zhin');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(stateRoot);
  const authority = exactAuthority();
  const view = Object.freeze({
    withCurrent: vi.fn(async (_operation, use) => await use(Object.freeze({
      generation: 7,
      digest: sha('a'),
      tools: Object.freeze([{ id: 'tool:repo', digest: sha('1') }]),
      skills: Object.freeze([{ id: 'skill:code', digest: sha('2') }]),
      agents: Object.freeze([{ id: 'agent:lead', digest: sha('3') }]),
    }))),
  });
  const runPinAuthority = Object.freeze({
    authorize: vi.fn(async (request: Readonly<{ digest: string }>) => Object.freeze({
      requestDigest: request.digest,
      authorityDigest: sha('e'),
    })),
    verify: vi.fn(async (
      request: Readonly<{ digest: string }>,
      authority: Readonly<{ requestDigest: string }>,
    ) => authority.requestDigest === request.digest),
  });
  const directory = join(stateRoot, 'workroom-profile-authority');
  const journalDirectory = join(stateRoot, 'workroom-project-profiles');
  return {
    root,
    directory,
    journalDirectory,
    authority,
    view,
    runPinAuthority,
    runPinProofs: new FileWorkroomRunProfilePinProofRepository(
      join(directory, 'run-pin-proofs'),
      runPinAuthority,
    ),
    runtime: new WorkroomProfileAuthorityRuntime({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      repository: new FileWorkroomProfileAuthorityRepository(directory, authority),
      profileJournal: new FileProjectProfileJournal(journalDirectory),
      authority,
      generationView: view,
      runPinAuthority,
      runPinProofs: new FileWorkroomRunProfilePinProofRepository(
        join(directory, 'run-pin-proofs'),
        runPinAuthority,
      ),
    }),
  };
}

describe('Workroom Profile authority production runtime', () => {
  it('exposes an exact Planning Policy read through the narrow control port', async () => {
    const fixture = await setup();
    await expect(fixture.runtime.control.readPlanningPolicy('project:missing', 'profile:missing'))
      .resolves.toBeUndefined();
  });

  it('publishes one trusted content-addressed Pack revision and rejects same-version drift after restart', async () => {
    const fixture = await setup();
    const published = await fixture.runtime.control.publishPack({
      version: 1,
      operationId: 'pack:publish:1',
      authenticatedPrincipalId: 'publisher:alice',
      pack: packInput,
    }, new AbortController().signal);

    const restarted = new FileWorkroomProfileAuthorityRepository(fixture.directory, fixture.authority);
    expect(await restarted.readPack(published.pack)).toEqual(published);
    await expect(new FileWorkroomProfileAuthorityRepository(fixture.directory).readPack(published.pack))
      .rejects.toThrow('verification is unavailable');
    expect(await fixture.runtime.control.publishPack({
      version: 1,
      operationId: 'pack:publish:1',
      authenticatedPrincipalId: 'publisher:alice',
      pack: packInput,
    }, new AbortController().signal)).toEqual(published);
    await expect(fixture.runtime.control.publishPack({
      version: 1,
      operationId: 'pack:publish:drift',
      authenticatedPrincipalId: 'publisher:alice',
      pack: { ...packInput, tools: [{ id: 'tool:repo', digest: sha('9') }] },
    }, new AbortController().signal)).rejects.toThrow('identity payload drift');
    expect(fixture.authority.authorize).toHaveBeenCalledWith(expect.objectContaining({
      action: 'publish_pack', authenticatedPrincipalId: 'publisher:alice',
    }));
  });

  it('rejects a publisher decision that does not echo the authenticated operation exactly', async () => {
    const fixture = await setup();
    const forgedAuthority = Object.freeze({
      ...fixture.authority,
      authorize: vi.fn(async (request: WorkroomProfileAuthorityRequest) => Object.freeze({
        approved: true as const,
        requestDigest: request.digest,
        decisionId: 'decision:forged',
        decidedBy: 'publisher:mallory',
        authorizedBy: 'trusted_pack_publisher' as const,
        decidedAt: 100,
      })),
    });
    const runtime = new WorkroomProfileAuthorityRuntime({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      repository: new FileWorkroomProfileAuthorityRepository(fixture.directory, forgedAuthority),
      profileJournal: new FileProjectProfileJournal(fixture.journalDirectory),
      authority: forgedAuthority,
      generationView: fixture.view,
    });

    await expect(runtime.control.publishPack({
      version: 1, operationId: 'pack:forged', authenticatedPrincipalId: 'publisher:alice', pack: packInput,
    }, new AbortController().signal)).rejects.toThrow('exact decision echo mismatch');
  });

  it('detects persisted Pack corruption and makes concurrent same-version drift a single-winner CAS', async () => {
    const fixture = await setup();
    const left = fixture.runtime.control.publishPack({
      version: 1, operationId: 'pack:left', authenticatedPrincipalId: 'publisher:alice', pack: packInput,
    }, new AbortController().signal);
    const rightRuntime = new WorkroomProfileAuthorityRuntime({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      repository: new FileWorkroomProfileAuthorityRepository(fixture.directory, fixture.authority),
      profileJournal: new FileProjectProfileJournal(fixture.journalDirectory),
      authority: fixture.authority,
      generationView: fixture.view,
      runPinAuthority: fixture.runPinAuthority,
    });
    const right = rightRuntime.control.publishPack({
      version: 1, operationId: 'pack:right', authenticatedPrincipalId: 'publisher:alice',
      pack: { ...packInput, tools: [{ id: 'tool:repo', digest: sha('9') }] },
    }, new AbortController().signal);
    const settled = await Promise.allSettled([left, right]);
    expect(settled.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(value => value.status === 'rejected')).toHaveLength(1);
    const winner = settled.find(value => value.status === 'fulfilled') as PromiseFulfilledResult<Awaited<typeof left>>;
    expect(await new FileWorkroomProfileAuthorityRepository(fixture.directory, fixture.authority)
      .readPack(winner.value.pack)).toEqual(winner.value);

    const packDirectory = join(fixture.directory, 'packs');
    const [packName] = (await readdir(packDirectory)).filter(name => name.endsWith('.json'));
    await writeFile(join(packDirectory, packName!), '{"version":1}', 'utf8');
    await expect(new FileWorkroomProfileAuthorityRepository(fixture.directory, fixture.authority)
      .readPack(winner.value.pack)).rejects.toThrow(/malformed|digest mismatch/u);
  });

  it('fsyncs the immutable Pack file, repository leaf, and pre-existing parent before success', async () => {
    const fixture = await setup();
    const trace: string[] = [];
    const fileSystem: DurableFileSystem = Object.freeze({
      ...nodeDurableFileSystem,
      open: async (path, flags) => {
        const handle = await nodeDurableFileSystem.open(path, flags);
        return {
          writeFile: async (value, encoding) => await handle.writeFile(value, encoding),
          sync: async () => { trace.push(`sync:${path}`); await handle.sync(); },
          close: async () => await handle.close(),
        };
      },
    });
    const directory = join(fixture.root, '.zhin', 'workroom-profile-authority-fsync');
    const runtime = new WorkroomProfileAuthorityRuntime({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      repository: new FileWorkroomProfileAuthorityRepository(directory, fixture.authority, fileSystem),
      profileJournal: new FileProjectProfileJournal(fixture.journalDirectory),
      authority: fixture.authority,
      generationView: fixture.view,
      runPinAuthority: fixture.runPinAuthority,
    });

    await runtime.control.publishPack({
      version: 1, operationId: 'pack:fsync', authenticatedPrincipalId: 'publisher:alice', pack: packInput,
    }, new AbortController().signal);

    expect(trace.some(value => value.includes('.tmp'))).toBe(true);
    expect(trace).toContain(`sync:${join(directory, 'packs')}`);
    expect(trace).toContain(`sync:${directory}`);
    expect(trace).toContain(`sync:${join(fixture.root, '.zhin')}`);
  });

  it('compiles and activates a governed Profile only inside the current generation operation view', async () => {
    const fixture = await setup();
    const publication = await fixture.runtime.control.publishPack({
      version: 1, operationId: 'pack:publish:1', authenticatedPrincipalId: 'publisher:alice', pack: packInput,
    }, new AbortController().signal);
    const overlay = createWorkroomProfileOverlay({
      version: 1,
      projectId: 'project:alpha',
      revisionId: 'profile:r1',
      charterRevisionId: 'charter:r1',
      packs: [publication.pack],
      enabledTools: ['tool:repo'],
      enabledSkills: ['skill:code'],
      enabledAgents: ['agent:lead'],
      enabledWorkflows: ['workflow:delivery'],
    });

    const profile = await fixture.runtime.control.publishProfile({
      version: 1,
      operationId: 'profile:publish:r1',
      authenticatedPrincipalId: 'sponsor:bob',
      projectId: 'project:alpha',
      expectedRegistryRevision: -1,
      overlay,
      source: { kind: 'sponsor_decision', sourceId: 'sponsor-decision:1' },
      activate: true,
    }, new AbortController().signal);

    expect(profile.active).toMatchObject({ revisionId: 'profile:r1' });
    expect(profile.revisions['profile:r1']?.overlayDigest).toBe(overlay.digest);
    expect(fixture.view.withCurrent).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'profile:publish:r1', generation: 7,
    }), expect.any(Function));
    expect(fixture.authority.authorize).toHaveBeenCalledWith(expect.objectContaining({
      action: 'publish_profile', authenticatedPrincipalId: 'sponsor:bob',
    }));
    expect((await new WorkroomProfileAuthorityRuntime({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      repository: new FileWorkroomProfileAuthorityRepository(fixture.directory, fixture.authority),
      profileJournal: new FileProjectProfileJournal(fixture.journalDirectory),
      authority: fixture.authority,
      generationView: fixture.view,
      runPinAuthority: fixture.runPinAuthority,
    }).profiles.read('project:alpha')).active).toEqual(profile.active);
    await expect(new WorkroomProfileAuthorityRuntime({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      repository: new FileWorkroomProfileAuthorityRepository(fixture.directory),
      profileJournal: new FileProjectProfileJournal(fixture.journalDirectory),
      authority: fixture.authority,
      generationView: fixture.view,
      runPinAuthority: fixture.runPinAuthority,
    }).profiles.read('project:alpha')).rejects.toThrow('verification is unavailable');
    const proofDirectory = join(fixture.directory, 'profile-proofs');
    const [proofName] = (await readdir(proofDirectory)).filter(name => name.endsWith('.json'));
    await writeFile(join(proofDirectory, proofName!), '{"version":1}', 'utf8');
    await expect(fixture.runtime.profiles.read('project:alpha'))
      .rejects.toThrow(/malformed|digest mismatch/u);
  });

  it('persists a Sponsor-governed Planning Policy chain and resolves only an exact Catalog/Profile join', async () => {
    const fixture = await setup();
    const publication = await fixture.runtime.control.publishPack({
      version: 1, operationId: 'pack:publish:1', authenticatedPrincipalId: 'publisher:alice', pack: packInput,
    }, new AbortController().signal);
    const overlay = createWorkroomProfileOverlay({
      version: 1, projectId: 'project:alpha', revisionId: 'profile:r1', charterRevisionId: 'charter:r1',
      packs: [publication.pack], enabledTools: ['tool:repo'], enabledSkills: ['skill:code'],
      enabledAgents: ['agent:lead'], enabledWorkflows: ['workflow:delivery'],
    });
    const profile = await fixture.runtime.control.publishProfile({
      version: 1, operationId: 'profile:publish:r1', authenticatedPrincipalId: 'sponsor:bob',
      projectId: 'project:alpha', expectedRegistryRevision: -1, overlay,
      source: { kind: 'sponsor_decision', sourceId: 'sponsor-decision:1' }, activate: true,
    }, new AbortController().signal);
    const profileDigest = profile.active!.compiledDigest;
    const policy = createWorkroomDynamicPlanningPolicySnapshot({
      revisionId: 'planning:r1', maxTasks: 8, maxTotalAttempts: 16, maxAttemptsPerTask: 3,
      allowOptionalTasks: false, approvalRequiredAuthorities: ['repo:write'],
      sponsorGate: { owner: 'sponsor:bob', decisionTimeoutMs: 60_000 },
      schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
        policyRef: 'scheduler:project:alpha', revision: 1, pinnedAtSequence: 0,
        capacity: 2, agingStepMs: 10_000,
        starvationBoundMs: { urgent: 10_000, high: 20_000, normal: 30_000, low: 40_000 },
        preemptionDeadlineMs: 5_000,
      }),
      defaultSponsorLane: 'normal', defaultTaskDeadlineMs: 3_600_000, defaultPreemptibility: 'atomic',
    });
    const persisted = await fixture.runtime.control.publishPlanningPolicy({
      version: 1, operationId: 'policy:publish:r1', authenticatedPrincipalId: 'sponsor:bob',
      projectId: 'project:alpha', catalogRevision: sha('b'), projectDigest: sha('c'),
      profileRevisionId: 'profile:r1', profileDigest, revision: 1, policy,
    }, new AbortController().signal);

    const request: WorkroomDynamicPlanningPolicyRequest = {
      version: 1 as const,
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      projectId: 'project:alpha', catalogRevision: sha('b'), projectDigest: sha('c'),
      profile: {
        revisionId: 'profile:r1', digest: profileDigest,
        strategies: [], roles: [],
        capabilities: { tools: [], skills: [], integrations: [], authorities: [] },
      },
    };
    expect(await fixture.runtime.planningPolicy.resolve(request)).toMatchObject({
      policy, profileRevisionId: 'profile:r1', profileDigest,
    });
    expect(await new WorkroomProfileAuthorityRuntime({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      repository: new FileWorkroomProfileAuthorityRepository(fixture.directory, fixture.authority),
      profileJournal: new FileProjectProfileJournal(fixture.journalDirectory),
      authority: fixture.authority,
      generationView: fixture.view,
      runPinAuthority: fixture.runPinAuthority,
    }).planningPolicy.resolve({ ...request, catalogRevision: sha('d') })).toBeUndefined();
    await expect(fixture.runtime.control.publishPlanningPolicy({
      version: 1, operationId: 'policy:publish:conflict', authenticatedPrincipalId: 'sponsor:bob',
      projectId: 'project:alpha', catalogRevision: sha('b'), projectDigest: sha('c'),
      profileRevisionId: 'profile:r1', profileDigest, revision: 2, expectedPreviousDigest: sha('f'), policy,
    }, new AbortController().signal)).rejects.toThrow('previous digest');
    expect(persisted.governance.authorizedBy).toBe('sponsor');
  });

  it('keeps an existing Run pin unchanged after a later Profile activation', async () => {
    const fixture = await setup();
    const publication = await fixture.runtime.control.publishPack({
      version: 1, operationId: 'pack:publish:1', authenticatedPrincipalId: 'publisher:alice', pack: packInput,
    }, new AbortController().signal);
    const base = createWorkroomProfileOverlay({
      version: 1, projectId: 'project:alpha', revisionId: 'profile:r1', charterRevisionId: 'charter:r1',
      packs: [publication.pack], enabledTools: ['tool:repo'], enabledSkills: ['skill:code'],
      enabledAgents: ['agent:lead'], enabledWorkflows: ['workflow:delivery'],
    });
    const first = await fixture.runtime.control.publishProfile({
      version: 1, operationId: 'profile:r1', authenticatedPrincipalId: 'sponsor:bob',
      projectId: 'project:alpha', expectedRegistryRevision: -1, overlay: base,
      source: { kind: 'sponsor_decision', sourceId: 'decision:1' }, activate: true,
    }, new AbortController().signal);
    expect(fixture.runtime.control).not.toHaveProperty('pinRun');
    const forgedRunPinRuntime = new WorkroomProfileAuthorityRuntime({
      generation: createWorkroomDynamicPlanningGenerationSnapshot(7),
      repository: new FileWorkroomProfileAuthorityRepository(fixture.directory, fixture.authority),
      profileJournal: new FileProjectProfileJournal(fixture.journalDirectory),
      authority: fixture.authority,
      generationView: fixture.view,
      runPinAuthority: {
        authorize: async () => ({ requestDigest: sha('0'), authorityDigest: sha('e') }),
        verify: async () => false,
      },
      runPinProofs: fixture.runPinProofs,
    });
    await expect(forgedRunPinRuntime.runPins.pin({
      version: 1, operationId: 'pin:forged', principalId: 'principal:kernel',
      projectId: 'project:alpha', runId: 'run:1',
      planRevisionId: 'plan:r1', planDigest: sha('6'), runFactDigest: sha('7'),
      profileRevisionId: 'profile:r1', profileDigest: first.active!.compiledDigest,
      expectedRegistryRevision: first.registryRevision,
    }, new AbortController().signal)).rejects.toThrow('exact echo mismatch');
    const pin = await fixture.runtime.runPins.pin({
      version: 1, operationId: 'pin:run:1', projectId: 'project:alpha', runId: 'run:1',
      principalId: 'principal:kernel',
      planRevisionId: 'plan:r1', planDigest: sha('6'), runFactDigest: sha('7'),
      profileRevisionId: 'profile:r1', profileDigest: first.active!.compiledDigest,
      expectedRegistryRevision: first.registryRevision,
    }, new AbortController().signal);
    const { digest: _baseDigest, ...baseInput } = base;
    const next = createWorkroomProfileOverlay({
      ...baseInput, revisionId: 'profile:r2', parentRevisionId: 'profile:r1',
    });
    await fixture.runtime.control.publishProfile({
      version: 1, operationId: 'profile:r2', authenticatedPrincipalId: 'sponsor:bob',
      projectId: 'project:alpha', expectedRegistryRevision: pin.pinnedAtRegistryRevision, overlay: next,
      source: { kind: 'sponsor_decision', sourceId: 'decision:2' }, activate: true,
    }, new AbortController().signal);

    const replayed = await fixture.runtime.runPins.pin({
      version: 1, operationId: 'pin:run:1:retry', projectId: 'project:alpha', runId: 'run:1',
      principalId: 'principal:kernel',
      planRevisionId: 'plan:r1', planDigest: sha('6'), runFactDigest: sha('7'),
      profileRevisionId: 'profile:r1', profileDigest: first.active!.compiledDigest,
      expectedRegistryRevision: pin.pinnedAtRegistryRevision + 2,
    }, new AbortController().signal);
    expect(replayed).toEqual(pin);
    expect(fixture.runPinAuthority.authorize).toHaveBeenCalledTimes(2);
  });
});
