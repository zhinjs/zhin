/**
 * ADR 0066 D5: the one-time migration of the interjection judge — every row of the table, the
 * record (`before`, `noticedAt`), CAS conflicts, failure without a write, and the revert command.
 */
import { normalizeProviderGraph, type CommitProviderGraphInput, type JsonObject, type ProviderGraph, type ProviderMutationResult } from '@zhin.js/ai/provider';
import {
  migrateAmbientJudge,
  needsAmbientJudgeMigration,
  noticeAmbientJudgeMigration,
  readAmbientJudgeMigration,
  revertAmbientJudgeMigration,
  type AmbientJudgeMigrationStore,
} from '../../src/plugin-runtime/inference/ambient-judge-migration.js';

const HOST = 'host:test';
const base = { rootId: 'root', ownerId: HOST, revision: 1 };

function graph(purposes: Record<string, unknown>, revision = 1, owner = HOST): ProviderGraph {
  const profile = (id: string, model: string, ownerId = HOST) => ({ ...base, ownerId, id, accountId: ownerId === HOST ? 'account' : 'personal', model, parameters: {} });
  const account = (id: string, ownerId: string) => ({ ...base, ownerId, id, serviceId: 'service', incarnation: id, authentication: { method: 'none' } });
  return normalizeProviderGraph({ rootId: 'root', revision,
    services: { service: { ...base, id: 'service', driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' }, options: {}, models: {
      text: { id: 'text', kinds: ['language'], protocol: 'fixture' }, jev: { id: 'jev', kinds: ['decision'], protocol: 'native' } } } },
    accounts: { account: account('account', HOST), personal: account('personal', 'user:1') },
    profiles: { chat: profile('chat', 'text'), small: profile('small', 'text'), spare: profile('spare', 'text'), jev: profile('jev', 'jev'),
      mine: profile('mine', 'text', owner === HOST ? 'user:1' : owner) },
    purposes });
}

class MemoryStore implements AmbientJudgeMigrationStore {
  record?: JsonObject;
  conflicts = 0;
  commits: CommitProviderGraphInput[] = [];
  constructor(public graph: ProviderGraph) {}
  async readGraph() { return this.graph; }
  async readMigrationRecord() { return this.record ? structuredClone(this.record) : undefined; }
  async writeMigrationRecord(input: { record: JsonObject }) { this.record = structuredClone(input.record); }
  async commitMigration(input: CommitProviderGraphInput & { migration: { id: string; record: JsonObject } }): Promise<ProviderMutationResult> {
    if (this.conflicts > 0) {
      this.conflicts -= 1;
      // Someone else wrote in between: the next read sees the newer revision.
      this.graph = normalizeProviderGraph({ ...this.graph, revision: this.graph.revision + 1 });
      return { status: 'conflict', reason: 'revision' };
    }
    if (input.expectedRevision !== this.graph.revision) return { status: 'conflict', reason: 'revision' };
    this.commits.push(input);
    this.graph = input.graph;
    this.record = structuredClone(input.migration.record);
    return { status: 'committed', replayed: false, receipt: { rootId: 'root', mutationId: input.mutationId, fingerprint: input.fingerprint, graphRevision: input.graph.revision, result: input.result } };
  }
}

const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe('migrateAmbientJudge (ADR 0066 D5)', () => {
  it('decision active: decision Profile first, the former language judge first fallback, the larger threshold, one CAS write with a record', async () => {
    const legacy = { defaults: { chat: 'chat', ambient: 'small', ambientFallbacks: ['spare'] }, decisions: { ambient: { profile: 'jev', mode: 'active', minConfidence: 0.8, timeoutMs: 1500 } } };
    const store = new MemoryStore(graph(legacy));
    const log = logger();
    const result = await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.6 }, now: () => 1000, logger: log });
    expect(result.status).toBe('migrated');
    expect(store.graph.revision).toBe(2);
    expect(store.graph.purposes).toEqual({ defaults: { chat: 'chat' }, ambient: { profile: 'jev', fallbacks: ['small', 'spare'], minConfidence: 0.8, timeoutMs: 1500 } });
    const record = await readAmbientJudgeMigration(store, 'root');
    expect(record).toMatchObject({ id: 'adr-0066-ambient-judge', status: 'migrated', at: 1000, graphRevision: 2,
      before: legacy, after: { profile: 'jev' }, triggerKeys: ['ai.trigger.ambient.minConfidence'] });
    expect(record?.notes?.map(note => note.code)).toEqual(['language-judge-became-fallback', 'threshold-max']);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('ambient_judge_migrated'));
    // Once: the next load finds nothing to do.
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.6 } })).resolves.toEqual({ status: 'none' });
    expect(store.commits).toHaveLength(1);
  });

  it('decision active with a judge that followed chat: chat is not added; shadow becomes compare; off is not migrated', async () => {
    const inherited = new MemoryStore(graph({ defaults: { chat: 'chat' }, decisions: { ambient: { profile: 'jev', mode: 'active' } } }));
    await migrateAmbientJudge({ store: inherited, rootId: 'root', hostOwnerId: HOST });
    expect(inherited.graph.purposes.ambient).toEqual({ profile: 'jev', minConfidence: 0.7 });

    const shadow = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' }, decisions: { ambient: { profile: 'jev', mode: 'shadow', minConfidence: 0.9 } } }));
    await migrateAmbientJudge({ store: shadow, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } });
    expect(shadow.graph.purposes.ambient).toEqual({ profile: 'small', compare: 'jev', mode: 'shadow' });

    const off = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' }, decisions: { ambient: { profile: 'jev', mode: 'off' }, tools: { profile: 'jev', mode: 'active' } } }));
    await migrateAmbientJudge({ store: off, rootId: 'root', hostOwnerId: HOST });
    expect(off.graph.purposes).toEqual({ defaults: { chat: 'chat' }, ambient: { profile: 'small' }, decisions: { tools: { profile: 'jev', mode: 'active' } } });
    expect(off.graph.profiles.jev).toBeDefined();
  });

  it('moves the yml mode: shadow into purposes.ambient.mode even without legacy stored fields (acceptance 5)', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat' } }));
    expect(needsAmbientJudgeMigration(store.graph, { mode: 'shadow' }, undefined)).toBe(true);
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } });
    expect(store.graph.purposes.ambient).toEqual({ mode: 'shadow' });
    // Removing the yml line afterwards changes nothing; the stored policy stays.
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST })).resolves.toEqual({ status: 'none' });
    expect(store.graph.purposes.ambient).toEqual({ mode: 'shadow' });
    // Nothing legacy anywhere: nothing to migrate.
    expect(needsAmbientJudgeMigration(graph({ defaults: {} }), undefined, undefined)).toBe(false);
  });

  it('retries a CAS conflict, and gives up after 3 without writing', async () => {
    const legacy = { defaults: { chat: 'chat', ambient: 'small' } };
    const store = new MemoryStore(graph(legacy));
    store.conflicts = 2;
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST })).resolves.toMatchObject({ status: 'migrated' });
    const stuck = new MemoryStore(graph(legacy));
    stuck.conflicts = 3;
    const log = logger();
    await expect(migrateAmbientJudge({ store: stuck, rootId: 'root', hostOwnerId: HOST, logger: log })).resolves.toMatchObject({ status: 'failed', record: { failure: { reason: 'conflict' } } });
    expect(stuck.graph.purposes.defaults.ambient).toBe('small');
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('ambient_judge_migration_failed'));
  });

  it('a result that does not validate writes no graph, records why with the path, and retries on the next load', async () => {
    // A personal Profile is not a deployment judge: the migration refuses it with its path.
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    store.graph = normalizeProviderGraph({ ...store.graph, purposes: { defaults: { chat: 'chat', ambient: 'mine' } } });
    const before = store.graph;
    const result = await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, now: () => 5 });
    expect(result).toMatchObject({ status: 'failed', record: { status: 'failed', failure: { reason: 'not-visible', path: 'purposes.ambient.profile' } } });
    expect(store.graph).toBe(before);
    expect(store.commits).toHaveLength(0);
    expect(needsAmbientJudgeMigration(store.graph, undefined, await readAmbientJudgeMigration(store, 'root'))).toBe(true);
  });

  it('records noticedAt once (zhin doctor shows the result one time)', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
    expect((await readAmbientJudgeMigration(store, 'root'))?.noticedAt).toBeUndefined();
    expect((await noticeAmbientJudgeMigration({ store, rootId: 'root', now: () => 42 }))?.noticedAt).toBe(42);
    expect((await noticeAmbientJudgeMigration({ store, rootId: 'root', now: () => 99 }))?.noticedAt).toBe(42);
  });
});

describe('revertAmbientJudgeMigration (zhin ai purposes revert ambient-judge, acceptance 7)', () => {
  const legacy = { defaults: { chat: 'chat', ambient: 'small', ambientFallbacks: ['spare'] }, decisions: { ambient: { profile: 'jev', mode: 'active', minConfidence: 0.8 } } };

  it('restores the purposes from before the migration and is not repeated automatically', async () => {
    const store = new MemoryStore(graph(legacy));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toEqual({ status: 'reverted', graphRevision: 3 });
    expect(store.graph.purposes).toEqual(legacy);
    expect(await readAmbientJudgeMigration(store, 'root')).toMatchObject({ status: 'reverted' });
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST })).resolves.toEqual({ status: 'none' });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toEqual({ status: 'refused', reason: 'already-reverted' });
  });

  it('refuses once purposes.ambient was changed after the migration, or without a migration', async () => {
    const store = new MemoryStore(graph(legacy));
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toEqual({ status: 'refused', reason: 'no-migration' });
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
    store.graph = normalizeProviderGraph({ ...store.graph, revision: store.graph.revision + 1, purposes: { ...store.graph.purposes, ambient: { profile: 'jev', minConfidence: 0.9 } } });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toEqual({ status: 'refused', reason: 'changed' });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'jev', minConfidence: 0.9 });
  });
});
