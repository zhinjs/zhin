/**
 * ADR 0066 D5: the one-time migration of the interjection judge — every row of the table, the
 * record (`before`, `noticedAt`), CAS conflicts, failure without a write, and the revert command.
 */
import { effectiveAmbientJudgePolicy, normalizeProviderGraph, type CommitProviderGraphInput, type JsonObject, type ProviderGraph, type ProviderMutationResult } from '@zhin.js/ai/provider';
import { ModelAvailabilityRegistry } from '@zhin.js/ai';
import { ambientJudgeStatusView } from '../../src/plugin-runtime/inference/host.js';
import { AmbientEngagement } from '../../src/plugin-runtime/ingress/ambient-engagement.js';
import {
  AMBIENT_JUDGE_REVERT_PENDING_MS,
  beginAmbientJudgeRevert,
  endAmbientJudgeRevert,
  reverseAmbientJudge,
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
  recordRevision = 0;
  conflicts = 0;
  commits: CommitProviderGraphInput[] = [];
  /** Runs once, between reading the record and writing it (a concurrent operation). */
  beforeRecordWrite?: () => Promise<unknown> | void;
  constructor(public graph: ProviderGraph) {}
  async readGraph() { return this.graph; }
  async readMigrationRecord() { return this.record ? structuredClone(this.record) : undefined; }
  async readMigrationRecordEntry() { return this.record ? { revision: this.recordRevision, record: structuredClone(this.record) } : undefined; }
  async writeMigrationRecord(input: { record: JsonObject; expectedRevision?: number; requireStatus?: string }): Promise<'written' | 'conflict'> {
    const concurrent = this.beforeRecordWrite;
    this.beforeRecordWrite = undefined;
    await concurrent?.();
    if (input.expectedRevision !== undefined && input.expectedRevision !== this.recordRevision) return 'conflict';
    if (input.requireStatus !== undefined && this.record?.status !== input.requireStatus) return 'conflict';
    this.record = structuredClone(input.record);
    this.recordRevision += 1;
    return 'written';
  }
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
    this.recordRevision += 1;
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

describe('the yml keys stay faithful on every path (review of ADR 0066)', () => {
  it('a purposes.ambient seeded before the migration keeps its values and takes the yml mode / threshold it lacks (M1)', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat' }, ambient: { profile: 'small', minConfidence: 0.9 } }));
    expect(needsAmbientJudgeMigration(store.graph, { mode: 'shadow', minConfidence: 0.5 }, undefined)).toBe(true);
    const result = await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow', minConfidence: 0.5 } });
    expect(result.status).toBe('migrated');
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', minConfidence: 0.9, mode: 'shadow' });
    expect(await readAmbientJudgeMigration(store, 'root')).toMatchObject({ triggerKeys: ['ai.trigger.ambient.minConfidence', 'ai.trigger.ambient.mode'],
      triggerValues: { minConfidence: 0.5, mode: 'shadow' }, rows: [{ field: 'mode', value: 'shadow', from: 'ai.trigger.ambient.mode' }] });
  });

  it('converts a later write of the retired keys (an older Console) into purposes.ambient, so it is not silently lost (H2)', async () => {
    const log = logger();
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small' });
    // The old Console writes ai.trigger.ambient.mode: shadow; the next load converts it.
    const converted = await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' }, logger: log });
    expect(converted).toMatchObject({ status: 'converted', keys: ['ai.trigger.ambient.mode'] });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', mode: 'shadow' });
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('ambient_trigger_write_converted'));
    // Seen: the same value again is not a new write; a Console edit of purposes.ambient afterwards wins.
    store.graph = normalizeProviderGraph({ ...store.graph, revision: store.graph.revision + 1, purposes: { ...store.graph.purposes, ambient: { profile: 'small', mode: 'active' } } });
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } })).resolves.toEqual({ status: 'none' });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', mode: 'active' });
    // Removing the key (doctor --fix) changes nothing but the record.
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST })).resolves.toEqual({ status: 'none' });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', mode: 'active' });
    expect(await readAmbientJudgeMigration(store, 'root')).toMatchObject({ triggerSeen: {} });
  });

  it('notice and revert at the same time: the revert wins and is not overwritten (L1)', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
    store.beforeRecordWrite = () => revertAmbientJudgeMigration({ store, rootId: 'root' });
    const noticed = await noticeAmbientJudgeMigration({ store, rootId: 'root', now: () => 7 });
    expect(await readAmbientJudgeMigration(store, 'root')).toMatchObject({ status: 'reverted' });
    expect((await readAmbientJudgeMigration(store, 'root'))?.noticedAt).toBeUndefined();
    expect(noticed?.noticedAt).toBeUndefined();
  });

  it('refuses a revert whose old form no longer validates, naming the path (L6)', async () => {
    // An off decision Profile is not migrated (the judge no longer references it) and is removed afterwards.
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' }, decisions: { ambient: { profile: 'jev', mode: 'off' } } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
    store.graph = normalizeProviderGraph({ ...store.graph, revision: store.graph.revision + 1,
      profiles: Object.fromEntries(Object.entries(store.graph.profiles).filter(([id]) => id !== 'jev')) });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toEqual({ status: 'refused', reason: 'invalid-graph', path: 'purposes.decisions.ambient.profile' });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small' });
  });

  it('reverts a yml-only migration to nothing stored, so the yml shadow applies again (M2)', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } });
    expect(store.graph.purposes.ambient).toEqual({ mode: 'shadow' });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toMatchObject({ status: 'reverted' });
    expect(store.graph.purposes).toEqual({ defaults: { chat: 'chat' } });
    // Reverted: the yml keys apply directly again and nothing is migrated automatically.
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } })).resolves.toEqual({ status: 'none' });
    expect(await readAmbientJudgeMigration(store, 'root')).toMatchObject({ status: 'reverted', triggerValues: { mode: 'shadow' } });
  });
});

it('after converting an old-key write of shadow, the status shows shadow and the bot does not speak (H2)', async () => {
  const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
  await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
  await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } });
  expect(ambientJudgeStatusView(store.graph, { mode: 'shadow' }, new ModelAvailabilityRegistry())).toMatchObject({ mode: 'shadow' });
  // The judge reads the policy in effect (as the ingress stage does) and carries it as its gate.
  const { policy } = effectiveAmbientJudgePolicy(store.graph.purposes, { mode: 'shadow' });
  const engagement = new AmbientEngagement({ config: { conversations: ['*'] }, sleep: async () => undefined,
    judge: { judge: async () => ({ engage: true, confidence: 0.95, reason: 'x', gate: { minConfidence: policy.minConfidence ?? 0.7, mode: policy.mode ?? 'active' } }) } });
  await expect(engagement.consider({ key: 'qq:1', botName: 'bot', readRecent: async () => ['a'] })).resolves.toMatchObject({ kind: 'shadow' });
});

describe('writing the original yml values back is no new write (review N1, N2)', () => {
  it('case A: active decision 0.8 over yml 0.6 + shadow; after --fix the yml gets 0.6 back: the judge keeps 0.8 and the revert still works', async () => {
    const legacy = { defaults: { chat: 'chat', ambient: 'small' }, decisions: { ambient: { profile: 'jev', mode: 'active', minConfidence: 0.8 } } };
    const store = new MemoryStore(graph(legacy));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.6, mode: 'shadow' } });
    const migrated = store.graph.purposes.ambient;
    expect(migrated).toEqual({ profile: 'jev', fallbacks: ['small'], minConfidence: 0.8, mode: 'shadow' });
    // doctor --fix removed both keys; the next load only updates the record.
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
    // Someone (or the revert command) writes the original values back.
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.6, mode: 'shadow' } })).resolves.toEqual({ status: 'none' });
    expect(store.graph.purposes.ambient).toEqual(migrated);
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toMatchObject({ status: 'reverted' });
    expect(store.graph.purposes).toEqual(legacy);
  });

  it('case B: a seeded shadow over yml active; after --fix the yml gets active back: the bot stays in shadow', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat' }, ambient: { mode: 'shadow' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'active' } });
    expect(store.graph.purposes.ambient).toEqual({ mode: 'shadow' });
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'active' } })).resolves.toEqual({ status: 'none' });
    expect(store.graph.purposes.ambient).toEqual({ mode: 'shadow' });
    // A really new value is still converted, normalized like at run time.
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'active', minConfidence: 1.4 } }))
      .resolves.toMatchObject({ status: 'converted', keys: ['ai.trigger.ambient.minConfidence'] });
    expect(store.graph.purposes.ambient).toEqual({ mode: 'shadow', minConfidence: 1 });
  });

  it('does not convert while a revert is pending, so a reload during the revert cannot block it; the mark expires', async () => {
    let now = 1_000;
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, now: () => now });
    await expect(beginAmbientJudgeRevert({ store, rootId: 'root', now: () => now })).resolves.toBe('pending');
    // A reload in the middle of the revert sees a new yml value: no conversion.
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' }, now: () => now })).resolves.toEqual({ status: 'none' });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small' });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root', now: () => now })).resolves.toMatchObject({ status: 'reverted' });
    expect(await readAmbientJudgeMigration(store, 'root')).not.toHaveProperty('revertPending');
    await endAmbientJudgeRevert({ store, rootId: 'root' });

    // A revert that never cleared its mark stops pausing conversions after the timeout.
    const stale = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store: stale, rootId: 'root', hostOwnerId: HOST, now: () => now });
    await beginAmbientJudgeRevert({ store: stale, rootId: 'root', now: () => now });
    now += AMBIENT_JUDGE_REVERT_PENDING_MS + 1;
    await expect(migrateAmbientJudge({ store: stale, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' }, now: () => now })).resolves.toMatchObject({ status: 'converted' });
    // endAmbientJudgeRevert clears it after a refused revert too.
    await endAmbientJudgeRevert({ store: stale, rootId: 'root' });
    expect(await readAmbientJudgeMigration(stale, 'root')).not.toHaveProperty('revertPending');
  });

  it('reverts a purposes.ambient seeded before the migration into the legacy fields an older version reads (N2)', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat' }, ambient: { profile: 'jev', fallbacks: ['small', 'spare'], minConfidence: 0.8, mode: 'shadow', timeoutMs: 900 } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'active' } });
    const result = await revertAmbientJudgeMigration({ store, rootId: 'root' });
    expect(result).toMatchObject({ status: 'reverted', yml: { minConfidence: 0.8, mode: 'shadow' } });
    expect(store.graph.purposes).toEqual({ defaults: { chat: 'chat', ambient: 'small', ambientFallbacks: ['spare'] },
      decisions: { ambient: { profile: 'jev', mode: 'active', timeoutMs: 900, minConfidence: 0.8 } } });
    expect(store.graph.purposes.ambient).toBeUndefined();
    expect(result.status === 'reverted' && result.lost).toEqual([expect.stringContaining('决策模型 jev 失败时换到语言模型 small')]);

    // A language judge with a compared decision model becomes the old shadow; a compared language model cannot be expressed.
    expect(reverseAmbientJudge({ profile: 'small', compare: 'jev' }, store.graph)).toMatchObject({ language: { profile: 'small' }, decision: { profile: 'jev', mode: 'shadow' }, lost: [] });
    expect(reverseAmbientJudge({ profile: 'small', compare: 'spare' }, store.graph).lost).toEqual([expect.stringContaining('对照模型 spare')]);
  });
});

describe('switching back to the original value is a real write once the key was changed (review R1)', () => {
  it('case C: yml shadow → old Console active → shadow again ends in shadow', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', mode: 'shadow' });
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'active' } });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', mode: 'active' });
    await expect(migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } })).resolves.toMatchObject({ status: 'converted' });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', mode: 'shadow' });
  });

  it('the threshold too: 0.8 → 0.5 → 0.8 ends at 0.8; the original value is still skipped while unchanged (cases A / B)', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.8 } });
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.5 } });
    expect(store.graph.purposes.ambient).toMatchObject({ minConfidence: 0.5 });
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.8 } });
    expect(store.graph.purposes.ambient).toMatchObject({ minConfidence: 0.8 });
  });
});

describe('revert dry run (review R2)', () => {
  it('case D: a seeded shadow over yml active — the dry run names the shadow for the yml and writes nothing', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat' }, ambient: { profile: 'small', mode: 'shadow' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'active' } });
    const before = store.graph;
    const commits = store.commits.length;
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root', dryRun: true })).resolves.toEqual({ status: 'ready', yml: { mode: 'shadow' } });
    expect(store.graph).toBe(before);
    expect(store.commits).toHaveLength(commits);
    // The yml the CLI writes (mode: shadow) plus the reverted graph run in shadow, as now.
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toMatchObject({ status: 'reverted', yml: { mode: 'shadow' } });
    expect(effectiveAmbientJudgePolicy(store.graph.purposes, { mode: 'shadow' }).policy).toMatchObject({ profile: 'small', mode: 'shadow' });
  });

  it('a legacy migration hands the yml values it read back for the yml', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow', minConfidence: 0.6 } });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root', dryRun: true })).resolves.toEqual({ status: 'ready', yml: { minConfidence: 0.6, mode: 'shadow' } });
  });
});

describe('the revert never overwrites a yml write the instance has not converted yet (review S1)', () => {
  it('case F: yml active, an old Console writes shadow, no reload yet — the revert is refused; after the reload it reverts and stays shadow', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'active' } });
    const file = { mode: 'shadow' };
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root', dryRun: true, trigger: file }))
      .resolves.toEqual({ status: 'refused', reason: 'pending-trigger-writes', keys: ['ai.trigger.ambient.mode'] });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root', trigger: file })).resolves.toMatchObject({ reason: 'pending-trigger-writes' });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', mode: 'active' });
    // The reload converts the write; now the revert goes through and the yml it needs is shadow.
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: file });
    expect(store.graph.purposes.ambient).toEqual({ profile: 'small', mode: 'shadow' });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root', dryRun: true, trigger: file })).resolves.toEqual({ status: 'ready', yml: { mode: 'shadow' } });
    const reverted = await revertAmbientJudgeMigration({ store, rootId: 'root', trigger: file });
    expect(reverted).toMatchObject({ status: 'reverted', yml: { mode: 'shadow' } });
    expect(effectiveAmbientJudgePolicy(store.graph.purposes, file).policy).toEqual({ profile: 'small', mode: 'shadow' });
  });

  it('a converted threshold keeps gating an active legacy decision after the revert', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' }, decisions: { ambient: { profile: 'jev', mode: 'active', minConfidence: 0.8 } } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.6 } });
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.9 } });
    expect(store.graph.purposes.ambient).toMatchObject({ minConfidence: 0.9 });
    const reverted = await revertAmbientJudgeMigration({ store, rootId: 'root', trigger: { minConfidence: 0.9 } });
    expect(reverted).toMatchObject({ status: 'reverted', yml: { minConfidence: 0.9 } });
    expect(store.graph.purposes.decisions?.ambient).toMatchObject({ minConfidence: 0.9 });
    expect(effectiveAmbientJudgePolicy(store.graph.purposes, { minConfidence: 0.9 }).policy.minConfidence).toBe(0.9);
  });

  it('a threshold that is not in the yml (a Console edit) refuses the revert until the yml holds it too', async () => {
    const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
    await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { minConfidence: 0.6 } });
    store.graph = normalizeProviderGraph({ ...store.graph, revision: store.graph.revision + 1, purposes: { ...store.graph.purposes, ambient: { profile: 'small', minConfidence: 0.95 } } });
    // An older version reads the threshold from the yml only: the refusal says which value it must hold.
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toEqual({ status: 'refused', reason: 'changed', restore: { 'ai.trigger.ambient.minConfidence': 0.95 } });
    // Any other change (here the profile) is refused without a hint.
    store.graph = normalizeProviderGraph({ ...store.graph, revision: store.graph.revision + 1, purposes: { ...store.graph.purposes, ambient: { profile: 'chat', minConfidence: 0.6 } } });
    await expect(revertAmbientJudgeMigration({ store, rootId: 'root' })).resolves.toEqual({ status: 'refused', reason: 'changed' });
  });
});

it('case H: a converted yml value removed by --fix blocks the revert with how to unblock it (review T3)', async () => {
  const store = new MemoryStore(graph({ defaults: { chat: 'chat', ambient: 'small' } }));
  await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'active' } });
  await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST, trigger: { mode: 'shadow' } });
  // doctor --fix removed the converted key; the next load forgot it.
  await migrateAmbientJudge({ store, rootId: 'root', hostOwnerId: HOST });
  await expect(revertAmbientJudgeMigration({ store, rootId: 'root', dryRun: true, trigger: {} }))
    .resolves.toEqual({ status: 'refused', reason: 'changed', restore: { 'ai.trigger.ambient.mode': 'shadow' } });
  // Written back to the file: not a pending write (it is what runs) and the revert goes through.
  await expect(revertAmbientJudgeMigration({ store, rootId: 'root', dryRun: true, trigger: { mode: 'shadow' } })).resolves.toEqual({ status: 'ready', yml: { mode: 'shadow' } });
  await expect(revertAmbientJudgeMigration({ store, rootId: 'root', trigger: { mode: 'shadow' } })).resolves.toMatchObject({ status: 'reverted' });
});
