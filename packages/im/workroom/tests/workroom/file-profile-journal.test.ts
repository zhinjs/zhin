import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileProjectProfileJournal,
  type ProjectProfileJournalFileSystem,
} from '../../src/workroom/file-profile-journal.js';
import {
  compileWorkroomProfile,
  type CapabilityPack,
} from '../../src/workroom/profile-compiler.js';
import {
  MemoryProjectProfileJournal,
  ProjectProfileRegistry,
  type ProjectProfileEventDraft,
  type ProjectProfileGovernancePort,
  type ProjectProfileJournal,
  type ProjectProfileRevisionCandidate,
} from '../../src/workroom/profile-registry.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })));
});

interface JournalFixture {
  readonly journal: ProjectProfileJournal;
  readonly restart: () => ProjectProfileJournal;
}

const journals: readonly Readonly<{
  name: string;
  create(): JournalFixture;
}>[] = [
  {
    name: 'memory',
    create: () => {
      const journal = new MemoryProjectProfileJournal();
      return { journal, restart: () => journal };
    },
  },
  {
    name: 'file',
    create: () => {
      const directory = temporaryDirectory('registry-contract');
      return {
        journal: new FileProjectProfileJournal(directory),
        restart: () => new FileProjectProfileJournal(directory),
      };
    },
  },
];

describe.each(journals)('$name Project Profile Journal Registry contract', ({ create }) => {
  it('preserves immutable Revision, activation, and Run pin facts across restart', async () => {
    const { journal, restart } = create();
    const registry = new ProjectProfileRegistry(journal, allowingGovernance);
    const candidate = revision('profile-1');

    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: candidate,
    });
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revisionId: candidate.revisionId,
      compiledDigest: candidate.compiledDigest,
    });
    await registry.pinRun({
      projectId: 'project-a',
      runId: 'run-1',
      expectedRegistryRevision: 1,
    });

    const recovered = await new ProjectProfileRegistry(restart()).read('project-a');
    expect(recovered).toMatchObject({
      projectId: 'project-a',
      registryRevision: 2,
      active: {
        revisionId: 'profile-1',
        compiledDigest: candidate.compiledDigest,
        activatedAtRegistryRevision: 1,
      },
      runPins: {
        'run-1': {
          profileRevisionId: 'profile-1',
          profileDigest: candidate.compiledDigest,
          pinnedAtRegistryRevision: 2,
        },
      },
    });
    expect(Object.isFrozen(recovered)).toBe(true);
    expect(Object.isFrozen(recovered.revisions['profile-1']?.compiledProfile.tools)).toBe(true);
  });
});

describe('File Project Profile Journal concurrency', () => {
  it('uses Registry revision CAS across instances and accepts only an exact durable replay', async () => {
    const directory = temporaryDirectory('cross-instance-cas');
    const first = new FileProjectProfileJournal(directory);
    const second = new FileProjectProfileJournal(directory);
    const attempts = await Promise.allSettled([
      new ProjectProfileRegistry(first, allowingGovernance).registerRevision({
        projectId: 'project-a',
        expectedRegistryRevision: -1,
        revision: revision('profile-left'),
      }),
      new ProjectProfileRegistry(second, allowingGovernance).registerRevision({
        projectId: 'project-a',
        expectedRegistryRevision: -1,
        revision: revision('profile-right'),
      }),
    ]);

    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    const [persisted] = await first.read('project-a');
    expect(persisted).toMatchObject({ sequence: 0, type: 'profile.revision_registered' });
    const { version: _version, projectId: _projectId, sequence: _sequence, ...draft } = persisted!;
    await expect(second.append('project-a', -1, [draft])).resolves.toEqual([persisted]);

    const drifted = {
      ...draft,
      payload: {
        revision: {
          ...draft.payload.revision,
          source: { kind: 'acceptance_record' as const, sourceId: 'acceptance-drifted' },
        },
      },
    };
    await expect(second.append('project-a', -1, [drifted]))
      .rejects.toThrow('replay payload drift');
    await expect(first.read('project-a')).resolves.toHaveLength(1);
  });
});

describe('File Project Profile Journal durability', () => {
  it('syncs the durable parent, file content, and committed leaf entry before confirming append', async () => {
    const directory = temporaryDirectory('durability-order');
    const trace: string[] = [];
    const journal = new FileProjectProfileJournal(directory, tracingFileSystem(trace));

    await new ProjectProfileRegistry(journal, allowingGovernance).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    });

    expect(trace.filter(entry => entry !== 'readdir')).toEqual([
      'mkdir',
      'open:r',
      'sync:r',
      'close:r',
      'open:wx',
      'write:wx',
      'sync:wx',
      'close:wx',
      'link',
      'unlink',
      'open:r',
      'sync:r',
      'close:r',
      'open:r',
      'sync:r',
      'close:r',
    ]);
    await expect(new FileProjectProfileJournal(directory).read('project-a'))
      .resolves.toHaveLength(1);
  });

  it('fails before publication when the new leaf parent cannot be synced', async () => {
    const directory = temporaryDirectory('parent-sync-failure');
    const trace: string[] = [];
    const realFileSystem = tracingFileSystem(trace);
    const journal = new FileProjectProfileJournal(directory, {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'r') return handle;
        return {
          ...handle,
          async sync() {
            trace.push('injected-parent-sync-failure');
            throw new Error('injected parent sync failure');
          },
        };
      },
    });

    await expect(new ProjectProfileRegistry(journal, allowingGovernance).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    })).rejects.toThrow('parent sync failure');
    expect(trace).not.toContain('open:wx');
    expect(trace).not.toContain('link');
    expect(await readdir(directory)).toEqual([]);
    await expect(new FileProjectProfileJournal(directory).read('project-a'))
      .resolves.toEqual([]);
  });

  it('does not recursively create an unverified durable parent chain', async () => {
    const cleanupRoot = temporaryDirectory('missing-parent');
    await mkdir(cleanupRoot);
    const directory = join(cleanupRoot, 'not-created', 'profile-journal');

    await expect(new ProjectProfileRegistry(
      new FileProjectProfileJournal(directory),
      allowingGovernance,
    ).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    })).rejects.toThrow('pre-existing durable parent');
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not publish or retain a temporary segment when file sync fails', async () => {
    const directory = temporaryDirectory('file-sync-failure');
    const trace: string[] = [];
    const realFileSystem = tracingFileSystem(trace);
    const journal = new FileProjectProfileJournal(directory, {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'wx') return handle;
        return {
          ...handle,
          async sync() {
            trace.push('injected-file-sync-failure');
            throw new Error('injected file sync failure');
          },
        };
      },
    });

    await expect(new ProjectProfileRegistry(journal, allowingGovernance).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    })).rejects.toThrow('file sync failure');
    expect(await readdir(directory)).toEqual([]);
    expect(trace).not.toContain('link');
    await expect(new FileProjectProfileJournal(directory).read('project-a'))
      .resolves.toEqual([]);
  });

  it('does not confirm a linked segment until a retry re-syncs the leaf directory', async () => {
    const directory = temporaryDirectory('directory-sync-failure');
    const trace: string[] = [];
    const realFileSystem = tracingFileSystem(trace);
    let directorySyncCount = 0;
    const journal = new FileProjectProfileJournal(directory, {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'r' || ++directorySyncCount !== 2) return handle;
        return {
          ...handle,
          async sync() {
            trace.push('injected-directory-sync-failure');
            throw new Error('injected directory sync failure');
          },
        };
      },
    });
    const candidate = revision('profile-1');

    await expect(new ProjectProfileRegistry(journal, allowingGovernance).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: candidate,
    })).rejects.toThrow('directory sync failure');
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);

    const retryTrace: string[] = [];
    const recovered = await new ProjectProfileRegistry(
      new FileProjectProfileJournal(directory, tracingFileSystem(retryTrace)),
    ).read('project-a');
    expect(recovered.revisions['profile-1']?.compiledDigest).toBe(candidate.compiledDigest);
    expect(retryTrace.filter(entry => entry.startsWith('open:') || entry.startsWith('sync:')))
      .toEqual(['open:r', 'sync:r']);
  });

  it('fails closed when a durable Registry event payload drifts', async () => {
    const directory = temporaryDirectory('payload-corruption');
    const journal = new FileProjectProfileJournal(directory);
    await new ProjectProfileRegistry(journal, allowingGovernance).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    });
    const [name] = await readdir(directory);
    const segment = JSON.parse(await readFile(join(directory, name!), 'utf8')) as {
      events: Array<{ payload: { revision: { source: { sourceId: string } } } }>;
    };
    segment.events[0]!.payload.revision.source.sourceId = 'acceptance-corrupted';
    await writeFile(join(directory, name!), JSON.stringify(segment), 'utf8');

    await expect(new FileProjectProfileJournal(directory).read('project-a'))
      .rejects.toThrow('payload digest mismatch');
  });

  it('fails closed on a durable segment gap instead of projecting partial history', async () => {
    const directory = temporaryDirectory('segment-gap');
    const journal = new FileProjectProfileJournal(directory);
    const registry = new ProjectProfileRegistry(journal, allowingGovernance);
    const candidate = revision('profile-1');
    await registry.registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: candidate,
    });
    await registry.activateRevision({
      projectId: 'project-a',
      expectedRegistryRevision: 0,
      revisionId: candidate.revisionId,
      compiledDigest: candidate.compiledDigest,
    });
    const names = (await readdir(directory)).sort();
    expect(names).toHaveLength(2);
    await unlink(join(directory, names[0]!));

    await expect(new FileProjectProfileJournal(directory).read('project-a'))
      .rejects.toThrow('segment sequence gap');
  });

  it('fails closed when a segment pathname no longer binds its first Registry sequence', async () => {
    const directory = temporaryDirectory('segment-name-drift');
    await new ProjectProfileRegistry(
      new FileProjectProfileJournal(directory),
      allowingGovernance,
    ).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    });
    const [name] = await readdir(directory);
    const driftedName = name!.replace(/\d{16}\.json$/u, '0000000000000001.json');
    await link(join(directory, name!), join(directory, driftedName));
    await unlink(join(directory, name!));

    await expect(new FileProjectProfileJournal(directory).read('project-a'))
      .rejects.toThrow('segment name');
  });

  it('keeps filesystem time and temporary randomness out of persisted Registry facts', async () => {
    const leftDirectory = temporaryDirectory('deterministic-left');
    const rightDirectory = temporaryDirectory('deterministic-right');
    for (const directory of [leftDirectory, rightDirectory]) {
      await new ProjectProfileRegistry(
        new FileProjectProfileJournal(directory),
        allowingGovernance,
      ).registerRevision({
        projectId: 'project-a',
        expectedRegistryRevision: -1,
        revision: revision('profile-1'),
      });
    }
    const [leftName] = await readdir(leftDirectory);
    const [rightName] = await readdir(rightDirectory);

    expect(rightName).toBe(leftName);
    expect(await readFile(join(rightDirectory, rightName!), 'utf8'))
      .toBe(await readFile(join(leftDirectory, leftName!), 'utf8'));
  });

  it('snapshots immutable event facts before awaiting filesystem I/O', async () => {
    const seed = new MemoryProjectProfileJournal();
    await new ProjectProfileRegistry(seed, allowingGovernance).registerRevision({
      projectId: 'project-a',
      expectedRegistryRevision: -1,
      revision: revision('profile-1'),
    });
    const [event] = await seed.read('project-a');
    if (event?.type !== 'profile.revision_registered') {
      throw new Error('Profile registration fixture missing');
    }
    const draft = JSON.parse(JSON.stringify({
      type: event.type,
      payload: event.payload,
    })) as Extract<ProjectProfileEventDraft, { type: 'profile.revision_registered' }>;
    const directory = temporaryDirectory('immutable-snapshot');
    const journal = new FileProjectProfileJournal(directory);

    const pending = journal.append('project-a', -1, [draft]);
    (draft.payload.revision.source as { sourceId: string }).sourceId = 'acceptance-mutated';
    await pending;

    const [persisted] = await journal.read('project-a');
    expect(persisted).toMatchObject({
      type: 'profile.revision_registered',
      payload: { revision: { source: { sourceId: 'acceptance-17' } } },
    });
  });
});

const allowingGovernance: ProjectProfileGovernancePort = {
  authorize: async input => ({
    approved: true,
    ...input,
    decisionId: 'profile-policy-17',
    route: input.semanticDiff.bootstrap || input.semanticDiff.authorityExpansion
      ? 'sponsor'
      : 'policy',
    outcome: 'approved',
    decidedBy: input.semanticDiff.bootstrap || input.semanticDiff.authorityExpansion
      ? 'principal:sponsor-1'
      : 'profile-policy:v1',
  }),
};

function revision(revisionId: string): ProjectProfileRevisionCandidate {
  const toolId = 'repo.read';
  const toolDigest = 'sha256:' + toolId + '-v1';
  const pack: CapabilityPack = {
    id: 'software-domain',
    version: '1.0.0',
    digest: 'sha256:software-domain-' + toolId + '-v1',
    kind: 'domain',
    tools: [{ id: toolId, digest: toolDigest }],
    skills: [],
    agents: [],
    workflows: [],
  };
  const result = compileWorkroomProfile({
    revision: {
      id: revisionId,
      projectId: 'project-a',
      charterRevisionId: 'charter-7',
      packs: [{ id: pack.id, version: pack.version, digest: pack.digest }],
      enabledTools: [toolId],
      enabledSkills: [],
      enabledAgents: [],
      enabledWorkflows: [],
    },
    packs: [pack],
    generationSupply: {
      tools: [{ id: toolId, digest: toolDigest }],
      skills: [],
      agents: [],
    },
  });
  if (!result.ok) throw new Error('Profile fixture must compile');
  return {
    revisionId,
    projectId: 'project-a',
    charterRevisionId: 'charter-7',
    packRefs: result.profile.packRefs,
    overlayDigest: 'sha256:project-overlay-v1',
    compiledDigest: result.profile.digest,
    compiledProfile: result.profile,
    source: { kind: 'acceptance_record', sourceId: 'acceptance-17' },
  };
}

function temporaryDirectory(label: string): string {
  const directory = join(
    tmpdir(),
    'workroom-profile-journal-' + label + '-' + Date.now()
      + '-' + Math.random().toString(36).slice(2),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function tracingFileSystem(trace: string[]): ProjectProfileJournalFileSystem {
  return {
    async mkdir(path) {
      trace.push('mkdir');
      await mkdir(path);
    },
    async readdir(path) {
      trace.push('readdir');
      return readdir(path);
    },
    readFile,
    async open(path, flags) {
      trace.push('open:' + flags);
      const handle = await open(path, flags);
      return {
        async writeFile(value, encoding) {
          trace.push('write:' + flags);
          await handle.writeFile(value, encoding);
        },
        async sync() {
          trace.push('sync:' + flags);
          await handle.sync();
        },
        async close() {
          trace.push('close:' + flags);
          await handle.close();
        },
      };
    },
    async link(existingPath, newPath) {
      trace.push('link');
      await link(existingPath, newPath);
    },
    async unlink(path) {
      trace.push('unlink');
      await unlink(path);
    },
  };
}
