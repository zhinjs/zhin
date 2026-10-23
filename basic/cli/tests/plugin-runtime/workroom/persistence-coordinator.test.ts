// 保留内部 import 的原因：该 coordinator 只在 Host 内部构造；存储模式、迁移与 prepare 行为无法通过公开接口单独触达。
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  type AIService,
} from '@zhin.js/agent';
import {
  ActivatableWorkroomCatalog,
  FileWorkroomCatalog,
  ActivatableWorkroomJournal,
  DatabaseWorkroomJournal,
  MemoryWorkroomJournalPayloadPort,
  WorkroomKernel,
} from '@zhin.js/workroom';
import { type ZhinAgent } from '@zhin.js/agent/runtime';
import { GenerationHandoffStack, Scope, databaseRootHostToken, rootPluginId } from '@zhin.js/plugin-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkroomPersistenceCoordinator } from '../../../src/plugin-runtime/workroom/persistence-coordinator.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('WorkroomPersistenceCoordinator', () => {
  it('activates the complete file persistence set before reporting readiness', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-persistence-'));
    temporaryDirectories.push(projectRoot);
    const markMemoryPersistenceReady = vi.fn();
    const journal = new ActivatableWorkroomJournal();
    const catalog = new ActivatableWorkroomCatalog();
    const persistence = new WorkroomPersistenceCoordinator({
      projectRoot,
      config: { sessions: { useDatabase: false } },
      fixedStorageMode: 'file',
      resources: new Scope(rootPluginId()),
      handoff: new GenerationHandoffStack(),
      service: {} as AIService,
      agent: { markMemoryPersistenceReady } as unknown as ZhinAgent,
      semanticMemory: null,
      journal,
      journalPayloads: {} as never,
      catalog,
      listAgentNames: () => [],
      recoverHumanIngress: async () => undefined,
    });

    await persistence.prepare();

    expect(persistence.usesDatabase).toBe(false);
    expect(persistence.pendingActivation).toBe(false);
    expect(journal.active).toBe(true);
    expect((await catalog.read()).definitions).toEqual({});
    expect(markMemoryPersistenceReady).not.toHaveBeenCalled();
  });

  it('reopens a persisted local Endpoint and rejects its removal during candidate activation before admission', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-local-restart-'));
    temporaryDirectories.push(projectRoot);
    const disk = new FileWorkroomCatalog(join(projectRoot, '.zhin/workroom-catalog.json'));
    await disk.replace({ local: { name: 'Local', enabled: true,
      members: [{ agent: 'planner', role: 'orchestrator' }], sponsors: ['sponsor'],
      conversation: { adapter: 'minimal-bot', endpoint: 'terminal', kind: 'group', id: 'local-space', agent: 'planner' },
    } }, (await disk.read()).revision);
    async function restart(keys: ReadonlySet<string>) {
      const handoff = new GenerationHandoffStack();
      const resolveKeys = vi.fn(async () => keys);
      const catalog = new ActivatableWorkroomCatalog();
      const persistence = new WorkroomPersistenceCoordinator({
        projectRoot, config: { sessions: { useDatabase: false } }, fixedStorageMode: 'file',
        resources: new Scope(rootPluginId()), handoff, service: {} as AIService,
        agent: { markMemoryPersistenceReady() {} } as unknown as ZhinAgent,
        semanticMemory: null, journal: new ActivatableWorkroomJournal(), journalPayloads: {} as never,
        catalog, listAgentNames: () => ['planner'], resolveConfiguredEndpointKeys: resolveKeys,
        recoverHumanIngress: async () => undefined,
      });
      await persistence.prepare();
      expect(resolveKeys).not.toHaveBeenCalled(); // no projected candidate exists during setup
      handoff.seal();
      return { activate: () => handoff.activateNext(new AbortController().signal), catalog };
    }
    const valid = await restart(new Set(['minimal-bot:terminal']));
    await valid.activate();
    expect((await valid.catalog.read()).definitions.local!.enabled).toBe(true);
    const removed = await restart(new Set());
    await expect(removed.activate()).rejects.toThrow('unknown configured Bot Endpoint');
    expect((await disk.read()).definitions.local!.enabled).toBe(true); // rejected candidate never rewrites persisted authority
  });

  it('rejects activation on a corrupt Workroom journal before any candidate port is mutated', async () => {
    const fixture = await legitJournalRows();
    // Sanity: the stored row is legitimate before tampering, so the later rejection is caused by the tamper alone.
    await expect(new DatabaseWorkroomJournal(fixture.database, fixture.model, fixture.payloads).scanStoredHeaders())
      .resolves.toHaveLength(1);
    const envelope = JSON.parse(String(fixture.rows[0]!.payload_json)) as { eventId: string };
    envelope.eventId = 'forged-event-id'; // stored_event_digest deliberately not recomputed
    fixture.rows[0]!.payload_json = JSON.stringify(envelope);
    const raw = {
      models: new Map<string, unknown>([
        ['workroom_events', fixture.model],
        ['workroom_catalog', { select: () => ({ where: async () => [] }) }],
      ]),
      transaction: fixture.database.transaction,
    };
    const resources = new Scope(rootPluginId());
    resources.provide(databaseRootHostToken, { define: vi.fn(), getRawDatabase: () => raw } as never);
    const agent = {
      configure: vi.fn(),
      upgradeProfilesToDatabase: vi.fn(),
      markMemoryPersistenceReady: vi.fn(),
    } as unknown as ZhinAgent;
    const handoff = new GenerationHandoffStack();
    const journal = new ActivatableWorkroomJournal();
    const catalog = new ActivatableWorkroomCatalog();
    const recoverHumanIngress = vi.fn(async () => undefined);
    const persistence = new WorkroomPersistenceCoordinator({
      projectRoot: process.cwd(),
      config: {},
      fixedStorageMode: 'database',
      resources,
      handoff,
      service: {} as AIService,
      agent,
      semanticMemory: null,
      journal,
      journalPayloads: fixture.payloads,
      catalog,
      listAgentNames: () => [],
      recoverHumanIngress,
    });

    await persistence.prepare();
    handoff.seal();
    const activation = handoff.activateNext(new AbortController().signal);
    await expect(activation).rejects.toThrow('Agent database persistence activation failed');
    await expect(activation).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining('stored event digest') }),
    });

    expect(agent.configure).not.toHaveBeenCalled();
    expect(agent.upgradeProfilesToDatabase).not.toHaveBeenCalled();
    expect(journal.active).toBe(false);
    await expect(Promise.resolve().then(() => catalog.read())).rejects.toThrow('not active');
    expect(recoverHumanIngress).not.toHaveBeenCalled();
    expect(agent.markMemoryPersistenceReady).not.toHaveBeenCalled();
  });

  it('rejects database mode when the process database Host is absent', async () => {
    const persistence = new WorkroomPersistenceCoordinator({
      projectRoot: process.cwd(),
      config: {},
      fixedStorageMode: 'database',
      resources: new Scope(rootPluginId()),
      handoff: new GenerationHandoffStack(),
      service: {} as AIService,
      agent: {} as ZhinAgent,
      semanticMemory: null,
      journal: new ActivatableWorkroomJournal(),
      journalPayloads: {} as never,
      catalog: new ActivatableWorkroomCatalog(),
      listAgentNames: () => [],
      recoverHumanIngress: async () => undefined,
    });

    await expect(persistence.prepare()).rejects.toThrow(
      'Process-fixed Workroom database storage requires the Database Root Host',
    );
  });
});

async function legitJournalRows() {
  const rows: Record<string, unknown>[] = [];
  const where = async (condition: Record<string, unknown>) => condition.run_id === undefined
    ? [...rows]
    : rows.filter(row => row.run_id === condition.run_id);
  const database = {
    transaction: async <T>(operation: (transaction: {
      select(table: string): { where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]> };
      insertMany(table: string, inserted: Record<string, unknown>[]): Promise<void>;
    }) => Promise<T>) => await operation({
      select: () => ({ where }),
      insertMany: async (_table: string, inserted: Record<string, unknown>[]) => {
        rows.push(...inserted.map(row => ({ ...row })));
      },
    }),
  };
  const model = { select: () => ({ where }) };
  const payloads = new MemoryWorkroomJournalPayloadPort();
  const kernel = new WorkroomKernel({
    journal: new DatabaseWorkroomJournal(database, model, payloads),
    now: () => 100,
    createId: (() => { let id = 0; return () => `corrupt-activation-${++id}`; })(),
  });
  await kernel.createRun({ runId: 'run-corrupt-activation', projectId: 'support', title: 'private title' });
  return { rows, database, model, payloads };
}
