import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileProjectKnowledgeJournal,
  MemoryProjectKnowledgeJournal,
  ProjectKnowledgeRegistry,
  createProjectKnowledgeEntry,
  type ProjectKnowledgeSource,
} from '../../src/workroom/project-knowledge-registry.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const source = (projectId: string, kind: ProjectKnowledgeSource['kind'] = 'accepted_task_memory') => {
  const body = kind === 'accepted_task_memory'
    ? { kind, projectId, sourceId: `memory:${projectId}:1`, acceptanceId: `acceptance:${projectId}:1` }
    : kind === 'trusted_pack_publication'
      ? {
          kind, projectId, sourceId: `pack:${projectId}:1`,
          packRef: { id: `${projectId}-pack`, version: '1', digest: digest({ projectId, pack: 1 }) },
        }
      : { kind, projectId, sourceId: `${kind}:${projectId}:1` };
  return Object.freeze({ ...body, digest: digest(body) }) as ProjectKnowledgeSource;
};

const generationView = (current = 7) => ({
  withCurrent: async <T>(input: { generation: number }, use: () => T | Promise<T>): Promise<T> => {
    if (input.generation !== current) throw new Error('Project Knowledge generation is stale');
    return await use();
  },
});

const authority = {
  verify: async (candidate: ProjectKnowledgeSource) => candidate.digest === digest({
    kind: candidate.kind,
    projectId: candidate.projectId,
    sourceId: candidate.sourceId,
    ...('acceptanceId' in candidate ? { acceptanceId: candidate.acceptanceId } : {}),
    ...('packRef' in candidate ? { packRef: candidate.packRef } : {}),
  }),
};

function entry(projectId: string, id: string, kind: 'memory' | 'glossary', sensitivity = 'standard' as const) {
  return createProjectKnowledgeEntry({
    version: 1,
    projectId,
    knowledgeId: id,
    kind,
    governedContent: {
      ref: `vault://${projectId}/${id}`,
      digest: digest({ projectId, id, payload: 'stored in governed vault' }),
    },
    schema: { ref: `schema://${kind}/v1`, digest: digest({ kind, version: 1 }) },
    sensitivity,
    selectors: kind === 'glossary' ? ['glossary'] : ['memory'],
  });
}

describe('Project-local Memory/Glossary registry', () => {
  it('accepts only authoritative structured sources and never discussion, compaction, or execution completion', async () => {
    const registry = new ProjectKnowledgeRegistry({
      journal: new MemoryProjectKnowledgeJournal(), generationView: generationView(), sourceAuthority: authority,
    });
    const controller = new AbortController();
    const validKinds: readonly ProjectKnowledgeSource['kind'][] = [
      'acceptance_record', 'accepted_task_memory', 'sponsor_decision', 'trusted_pack_publication',
    ];
    let expectedRevision = -1;
    for (const kind of validKinds) {
      const snapshot = await registry.publish({
        version: 1, generation: 7, operationId: `publish-${kind}`, projectId: 'software', expectedRevision,
        ownerPrincipalId: 'owner:software', source: source('software', kind),
        entries: [entry('software', `${kind}-knowledge`, 'memory')],
      }, controller.signal);
      expectedRevision = snapshot.revision;
    }
    for (const kind of ['discussion', 'compaction', 'execution_completed']) {
      await expect(registry.publish({
        version: 1, generation: 7, operationId: `forged-${kind}`, projectId: 'software',
        expectedRevision, ownerPrincipalId: 'executor:software', source: {
          kind, projectId: 'software', sourceId: `${kind}:1`, digest: digest({ kind }),
        } as never,
        entries: [entry('software', `forged-${kind}`, 'memory')],
      }, controller.signal)).rejects.toThrow(/source kind/u);
    }
  });

  it('isolates three domains, minimally loads selected governed handles, and never exposes support PII', async () => {
    const registry = new ProjectKnowledgeRegistry({
      journal: new MemoryProjectKnowledgeJournal(), generationView: generationView(), sourceAuthority: authority,
    });
    const controller = new AbortController();
    for (const [projectId, knowledgeId, kind, sensitivity] of [
      ['software', 'runtime-contract', 'memory', 'standard'],
      ['content', 'editorial-glossary', 'glossary', 'restricted'],
      ['customer-support', 'ticket-pii', 'memory', 'high'],
    ] as const) {
      const knowledge = projectId === 'customer-support'
        ? createProjectKnowledgeEntry({
            version: 1, projectId, knowledgeId, kind,
            governedContent: {
              ref: 'vault://customer-support/ticket-pii',
              digest: digest({ customerEmail: 'alice.high-risk@example.test' }),
            },
            schema: { ref: 'schema://memory/v1', digest: digest({ kind: 'memory', version: 1 }) },
            sensitivity, selectors: ['memory'],
          })
        : entry(projectId, knowledgeId, kind, sensitivity);
      await registry.publish({
        version: 1, generation: 7, operationId: `publish-${projectId}`, projectId, expectedRevision: -1,
        ownerPrincipalId: `owner:${projectId}`, source: source(projectId),
        entries: [knowledge],
      }, controller.signal);
    }

    const content = await registry.load({ projectId: 'content', knowledgeIds: ['editorial-glossary'] });
    expect(content.entries.map(value => value.knowledgeId)).toEqual(['editorial-glossary']);
    expect(content.entries[0]).not.toHaveProperty('display');
    expect(content.entries[0]).not.toHaveProperty('definition');
    expect(JSON.stringify(content)).not.toContain('ticket-pii');
    expect(JSON.stringify(await registry.read('software'))).not.toContain('alice.high-risk@example.test');
    expect(JSON.stringify(await registry.read('content'))).not.toContain('alice.high-risk@example.test');
    expect(JSON.stringify(await registry.read('customer-support'))).not.toContain('alice.high-risk@example.test');
    expect((await registry.load({ projectId: 'software', knowledgeIds: ['ticket-pii'] })).entries).toEqual([]);
  });

  it('requires Sponsor authority for conflicting replacement and rollback, and survives restart', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zhin-project-knowledge-'));
    await mkdir(join(parent, '.zhin'));
    const directory = join(parent, '.zhin', 'knowledge');
    const make = () => new ProjectKnowledgeRegistry({
      journal: new FileProjectKnowledgeJournal(directory), generationView: generationView(), sourceAuthority: authority,
    });
    const controller = new AbortController();
    let registry = make();
    const first = await registry.publish({
      version: 1, generation: 7, operationId: 'publish-glossary-v1', projectId: 'content', expectedRevision: -1,
      ownerPrincipalId: 'owner:content', source: source('content'),
      entries: [entry('content', 'house-style', 'glossary')],
    }, controller.signal);
    registry = make();
    const replay = await registry.publish({
      version: 1, generation: 7, operationId: 'publish-glossary-v1', projectId: 'content', expectedRevision: -1,
      ownerPrincipalId: 'owner:content', source: source('content'),
      entries: [entry('content', 'house-style', 'glossary')],
    }, controller.signal);
    expect(replay.revision).toBe(first.revision);
    const drift = createProjectKnowledgeEntry({
      version: 1, projectId: 'content', knowledgeId: 'house-style', kind: 'glossary',
      governedContent: { ref: 'vault://content/house-style', digest: digest({ changed: true }) },
      schema: { ref: 'schema://glossary/v1', digest: digest({ kind: 'glossary', version: 1 }) },
      sensitivity: 'standard', selectors: ['glossary'],
    });
    await expect(registry.publish({
      version: 1, generation: 7, operationId: 'conflict', projectId: 'content', expectedRevision: first.revision,
      ownerPrincipalId: 'owner:content', source: source('content'), entries: [drift],
    }, controller.signal)).rejects.toThrow(/Sponsor Decision/u);

    const second = await registry.publish({
      version: 1, generation: 7, operationId: 'replace', projectId: 'content', expectedRevision: first.revision,
      ownerPrincipalId: 'owner:content', source: source('content', 'sponsor_decision'), entries: [drift],
    }, controller.signal);
    registry = make();
    expect((await registry.read('content')).revision).toBe(second.revision);
    const rolledBack = await registry.rollback({
      version: 1, generation: 7, operationId: 'rollback', projectId: 'content',
      expectedRevision: second.revision, restoreRevision: first.revision,
      ownerPrincipalId: 'owner:content', source: source('content', 'sponsor_decision'),
    }, controller.signal);
    expect(rolledBack.entries[0]?.governedContent.digest).toBe(first.entries[0]?.governedContent.digest);
    await expect(registry.publish({
      version: 1, generation: 6, operationId: 'stale-hmr', projectId: 'content',
      expectedRevision: rolledBack.revision, ownerPrincipalId: 'owner:content',
      source: source('content'), entries: [entry('content', 'stale', 'memory')],
    }, controller.signal)).rejects.toThrow(/generation is stale/u);
  });
});
