import {
  ActivatableProjectKnowledgeJournal,
  DatabaseProjectKnowledgeJournal,
  WORKROOM_PROJECT_KNOWLEDGE_MODEL,
  defineProjectKnowledgeDatabaseModel,
  type ProjectKnowledgeDatabase,
  type ProjectKnowledgeDatabaseModel,
} from '../../src/workroom/database-project-knowledge-journal.js';
import {
  MemoryProjectKnowledgeJournal,
  ProjectKnowledgeRegistry,
  createProjectKnowledgeEntry,
} from '../../src/workroom/project-knowledge-registry.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

describe('Database Project Knowledge Journal', () => {
  it('keeps the writer unavailable until all File Projects copy and exact-reread successfully', async () => {
    const source = new MemoryProjectKnowledgeJournal();
    await seed(source, 'software', 'runtime-contract');
    await seed(source, 'content', 'editorial-glossary');
    const fixture = databaseFixture();
    const target = new DatabaseProjectKnowledgeJournal(fixture.database, fixture.model);
    const activatable = new ActivatableProjectKnowledgeJournal();
    expect(() => activatable.read('software')).toThrow('not active');
    await activatable.activate(target, ['software', 'content'], source);
    expect(await activatable.read('software')).toEqual(await source.read('software'));
    expect(await activatable.read('content')).toEqual(await source.read('content'));
    expect(fixture.isolationLevels).toEqual(['SERIALIZABLE', 'SERIALIZABLE']);
  });

  it('never publishes a mixed writer when a later Project diverges', async () => {
    const source = new MemoryProjectKnowledgeJournal();
    await seed(source, 'software', 'runtime-contract');
    await seed(source, 'content', 'editorial-glossary');
    const target = new MemoryProjectKnowledgeJournal();
    await seed(target, 'content', 'different-content');
    const activatable = new ActivatableProjectKnowledgeJournal();
    await expect(activatable.activate(target, ['software', 'content'], source))
      .rejects.toThrow('handoff diverged');
    expect(() => activatable.read('software')).toThrow('not active');
  });

  it('recovers exact CAS history after restart and registers its real schema', async () => {
    const fixture = databaseFixture();
    const first = new DatabaseProjectKnowledgeJournal(fixture.database, fixture.model);
    await seed(first, 'customer-support', 'ticket-policy');
    const restarted = new DatabaseProjectKnowledgeJournal(fixture.database, fixture.model);
    expect(await restarted.read('customer-support')).toHaveLength(1);
    const define = vi.fn();
    defineProjectKnowledgeDatabaseModel({ define });
    expect(define).toHaveBeenCalledWith('workroom_project_knowledge', WORKROOM_PROJECT_KNOWLEDGE_MODEL);
  });
});

async function seed(journal: MemoryProjectKnowledgeJournal | DatabaseProjectKnowledgeJournal, projectId: string, id: string) {
  const body = { kind: 'accepted_task_memory' as const, projectId, sourceId: `memory:${id}`, acceptanceId: `acceptance:${id}` };
  const registry = new ProjectKnowledgeRegistry({
    journal,
    generationView: { withCurrent: async (_input, use) => await use() },
    sourceAuthority: { verify: async () => true },
  });
  return await registry.publish({
    version: 1, generation: 1, operationId: `publish:${projectId}:${id}`, projectId, expectedRevision: -1,
    ownerPrincipalId: `owner:${projectId}`, source: { ...body, digest: digest(body) },
    entries: [createProjectKnowledgeEntry({
      version: 1, projectId, knowledgeId: id, kind: id.includes('glossary') ? 'glossary' : 'memory',
      governedContent: { ref: `vault://${projectId}/${id}`, digest: digest({ projectId, id }) },
      schema: { ref: 'schema://knowledge/v1', digest: digest({ schema: 1 }) },
      sensitivity: projectId === 'customer-support' ? 'high' : 'standard', selectors: ['assignment'],
    })],
  }, new AbortController().signal);
}

function databaseFixture() {
  const rows: Record<string, unknown>[] = [];
  const isolationLevels: string[] = [];
  const select = (query: Record<string, unknown>) => rows.filter(row =>
    Object.entries(query).every(([key, value]) => row[key] === value));
  const model: ProjectKnowledgeDatabaseModel = { select: () => ({ where: async query => select(query) }) };
  const database: ProjectKnowledgeDatabase = {
    transaction: async (operation, options) => {
      isolationLevels.push(options.isolationLevel);
      return await operation({
        select: () => ({ where: async query => select(query) }),
        insertMany: async (_table, inserted) => {
          if (inserted.some(candidate => rows.some(row => row.id === candidate.id))) {
            throw Object.assign(new Error('unique constraint'), { code: '23505' });
          }
          rows.push(...inserted);
        },
      });
    },
  };
  return { database, model, isolationLevels };
}
