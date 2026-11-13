import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { isGatewayOwnedTable } from '@zhin.js/database';
import {
  FEATURE_OVERRIDE_TABLE, FeatureOverrideConflictError, FeatureOverrideStorageUnavailableError, FeatureOverrideStore, LEGACY_FEATURE_CONVERSATION_TABLE,
  defineFeatureOverrideTable, featureOverrideRowId,
} from '../../../src/instance/console/feature-override-store.js';
import { CHAT_ROLE_TABLE, defineChatRoleTable } from '../../../src/instance/chat-roles.js';
import { sqliteAvailable } from '../sqlite-availability.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function sqlite() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-feature-store-'));
  directories.push(directory);
  const open = async () => {
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'bot.db') });
    defineFeatureOverrideTable(host);
    defineChatRoleTable(host);
    await host.start();
    return host;
  };
  return { open };
}

const key = 'qq/bot-1/group:1001';

describe('feature_overrides store', () => {
  it('uses instance-owned table names outside the gateway console_ namespace', () => {
    expect(isGatewayOwnedTable(FEATURE_OVERRIDE_TABLE)).toBe(false);
    expect(isGatewayOwnedTable(LEGACY_FEATURE_CONVERSATION_TABLE)).toBe(false);
    expect(isGatewayOwnedTable(CHAT_ROLE_TABLE)).toBe(false);
  });

  it('is an explicit in-memory store without a database and bumps the version per write', async () => {
    const store = new FeatureOverrideStore();
    await store.load();
    expect(store.persistent).toBe(true);
    const before = store.reader.version;
    const saved = await store.write({ plugin: 'repeater', key, next: () => ({ patch: { threshold: 5 } }), updatedBy: 'user:1' });
    expect(saved).toMatchObject({ status: 'saved', revision: 1 });
    expect(store.reader.version).toBe(before + 1);
    expect(store.reader.get('repeater', key)).toMatchObject({ patch: { threshold: 5 }, revision: 1, updatedBy: 'user:1' });
    expect(Object.isFrozen(store.get('repeater', key)!.patch)).toBe(true);
    expect(await store.write({ plugin: 'repeater', key, next: current => ({ patch: current!.patch }) })).toMatchObject({ status: 'unchanged' });
    expect(store.reader.version).toBe(before + 1);
  });

  it('stores every level below global, with the level derived from the key and the id from (plugin, level, key)', async () => {
    const store = new FeatureOverrideStore();
    await store.write({ plugin: 'rss', key: 'qq', next: () => ({ enabled: false, patch: {} }) });
    await store.write({ plugin: 'rss', key: 'qq/bot-1', next: () => ({ patch: { maxItems: 2 } }) });
    await store.write({ plugin: 'rss', key, next: () => ({ patch: { maxItems: 3 } }) });
    expect(store.get('rss', 'qq')).toMatchObject({ level: 'adapter', enabled: false });
    expect(store.get('rss', 'qq/bot-1')).toMatchObject({ level: 'endpoint', patch: { maxItems: 2 } });
    expect(store.list('conversation').map(row => row.key)).toEqual([key]);
    expect(store.list()).toHaveLength(3);
    // Revisions are per row.
    expect([store.revisionOf('rss', 'qq'), store.revisionOf('rss', 'qq/bot-1'), store.revisionOf('other', 'qq')]).toEqual([1, 1, 0]);
    await expect(store.write({ plugin: 'rss', key: '', next: () => ({ patch: { maxItems: 1 } }) })).rejects.toThrow(TypeError);
    expect(featureOverrideRowId('rss', 'adapter', 'qq')).toMatch(/^[a-f0-9]{64}$/u);
    expect(featureOverrideRowId('rss', 'adapter', 'qq')).not.toBe(featureOverrideRowId('rss', 'endpoint', 'qq'));
  });

  it('refuses writes on a database that cannot persist rows (ADR 0057 §2) and keeps nothing in memory', async () => {
    const database = { dialect: 'mongodb', started: true, models: { get: () => undefined } };
    const store = new FeatureOverrideStore({ database: database as never });
    await store.load();
    expect(store.persistent).toBe(false);
    await expect(store.write({ plugin: 'rss', key: 'qq', next: () => ({ enabled: false, patch: {} }) }))
      .rejects.toBeInstanceOf(FeatureOverrideStorageUnavailableError);
    expect(store.get('rss', 'qq')).toBeUndefined();
    expect(store.revisionOf('rss', 'qq')).toBe(0);
    // The one-time configuration import may still seed memory-only rows (never reported as saved).
    expect(store.seed([{ plugin: 'rss', key: 'qq', enabled: false, patch: {} }, { plugin: 'rss', key: '', patch: { x: 1 } }])).toBe(1);
    expect(store.get('rss', 'qq')).toMatchObject({ level: 'adapter', enabled: false });
  });

  it('rejects a stale expected revision (optimistic concurrency)', async () => {
    const store = new FeatureOverrideStore();
    await store.write({ plugin: 'rss', key, expectedRevision: 0, next: () => ({ enabled: false, patch: {} }) });
    expect(await store.write({ plugin: 'rss', key, expectedRevision: 0, next: () => null })).toEqual({ status: 'conflict', revision: 1 });
    expect(await store.write({ plugin: 'rss', key, expectedRevision: 1, next: () => null })).toMatchObject({ status: 'saved', revision: 2 });
    expect(store.get('rss', key)).toBeUndefined();
  });

  it('keeps revisions monotonic across removal so a stale compare-and-swap cannot succeed (no ABA)', async () => {
    const store = new FeatureOverrideStore();
    await store.write({ plugin: 'rss', key, next: () => ({ enabled: false, patch: {} }) }); // 1
    await store.write({ plugin: 'rss', key, next: () => null }); // 2 (tombstone)
    expect(store.revisionOf('rss', key)).toBe(2);
    // A client that read "1" (or "no override": 0) before the removal is refused.
    expect(await store.write({ plugin: 'rss', key, expectedRevision: 0, next: () => ({ enabled: false, patch: {} }) })).toEqual({ status: 'conflict', revision: 2 });
    expect(await store.write({ plugin: 'rss', key, expectedRevision: 1, next: () => ({ enabled: false, patch: {} }) })).toEqual({ status: 'conflict', revision: 2 });
    expect(await store.write({ plugin: 'rss', key, expectedRevision: 2, next: () => ({ enabled: false, patch: {} }) })).toMatchObject({ status: 'saved', revision: 3 });
    expect(store.list()).toHaveLength(1);
  });

  it.skipIf(!sqliteAvailable)('stores removals as tombstones that survive a reload and never list as overrides', async () => {
    const db = await sqlite();
    const first = await db.open();
    const store = new FeatureOverrideStore({ database: first });
    await store.load();
    await store.write({ plugin: 'rss', key, next: () => ({ enabled: false, patch: {} }) });
    await store.write({ plugin: 'rss', key, next: () => null });
    await first.stop();
    const second = await db.open();
    const reloaded = new FeatureOverrideStore({ database: second });
    await reloaded.load();
    expect(reloaded.list()).toEqual([]);
    expect(reloaded.get('rss', key)).toBeUndefined();
    expect(reloaded.revisionOf('rss', key)).toBe(2);
    expect(await reloaded.write({ plugin: 'rss', key, next: () => ({ patch: { maxItems: 2 } }) })).toMatchObject({ status: 'saved', revision: 3 });
    const third = new FeatureOverrideStore({ database: second });
    await third.load();
    expect(third.get('rss', key)).toMatchObject({ revision: 3, patch: { maxItems: 2 } });
    await second.stop();
  });

  it.skipIf(!sqliteAvailable)('copies ADR 0055 conversation rows once, keeps the old table untouched and never resurrects a removal', async () => {
    const db = await sqlite();
    const host = await db.open();
    const legacy = host.models.get(LEGACY_FEATURE_CONVERSATION_TABLE)!;
    const legacyId = (plugin: string, rowKey: string) => createHash('sha256').update(`${plugin}\0${rowKey}`).digest('hex');
    await legacy.insert({ id: legacyId('repeater', key), plugin: 'repeater', key, enabled: 0, patch: '{"threshold":4}', revision: 3, updated_at: 10, updated_by: 'chat:qq:1' });
    await legacy.insert({ id: legacyId('rss', 'qq/bot-1/group:2'), plugin: 'rss', key: 'qq/bot-1/group:2', enabled: null, patch: '{}', revision: 2, updated_at: 11, updated_by: null });
    await legacy.insert({ id: 'bogus', plugin: 'rss', key: 'not a key', enabled: null, patch: '{}', revision: 1, updated_at: 1, updated_by: null });
    const invalid: string[] = [];
    const store = new FeatureOverrideStore({ database: host });
    await store.load(id => invalid.push(id));
    expect(invalid).toEqual([`${LEGACY_FEATURE_CONVERSATION_TABLE}:bogus`]);
    expect(store.get('repeater', key)).toMatchObject({ level: 'conversation', enabled: false, patch: { threshold: 4 }, revision: 3, updatedBy: 'chat:qq:1' });
    // A legacy tombstone keeps its revision.
    expect(store.revisionOf('rss', 'qq/bot-1/group:2')).toBe(2);
    const stored = await host.models.get(FEATURE_OVERRIDE_TABLE)!.select('id', 'level').where({ plugin: 'repeater' });
    expect(stored).toEqual([{ id: featureOverrideRowId('repeater', 'conversation', key), level: 'conversation' }]);
    // Removed after the copy: a later start must not copy it back.
    await store.write({ plugin: 'repeater', key, next: () => null });
    const again = new FeatureOverrideStore({ database: host });
    await again.load();
    expect(again.get('repeater', key)).toBeUndefined();
    expect(again.revisionOf('repeater', key)).toBe(4);
    expect(await legacy.select('id')).toHaveLength(3);
    await host.stop();
  });

  it('treats a 0-row CAS update and a concurrent insert of the same key as conflicts, then reloads', async () => {
    type Row = Record<string, unknown>;
    const table = new Map<string, Row>();
    let updateAffects: number | undefined;
    let insertError: unknown;
    const matches = (row: Row, query: Row) => Object.entries(query).every(([field, value]) => row[field] === value);
    const model = {
      select: () => {
        let query: Row = {};
        const chain = { where: (next: Row) => { query = next; return chain; },
          then: (resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) =>
            Promise.resolve([...table.values()].filter(row => matches(row, query)).map(row => ({ ...row }))).then(resolve, reject) };
        return chain;
      },
      insert: async (row: Row) => { if (insertError) throw insertError; table.set(String(row.id), { ...row }); return { changes: 1 }; },
      update: (patch: Row) => ({ where: async (query: Row) => {
        if (updateAffects !== undefined) return updateAffects;
        let count = 0;
        for (const row of table.values()) if (matches(row, query)) { Object.assign(row, patch); count += 1; }
        return count;
      } }),
      delete: () => ({ where: async () => 0 }),
    };
    const database = { dialect: 'pg', started: true, models: { get: () => model },
      transaction: async <T>(callback: (transaction: { model: () => typeof model }) => Promise<T>) => callback({ model: () => model }) };
    const store = new FeatureOverrideStore({ database: database as never });
    await store.load();
    expect(store.persistent).toBe(true);
    await store.write({ plugin: 'rss', key, next: () => ({ patch: { maxItems: 1 } }) });
    // Another process bumped the row between our select and our update: 0 rows affected.
    updateAffects = 0;
    await expect(store.write({ plugin: 'rss', key, next: () => ({ patch: { maxItems: 2 } }) })).rejects.toBeInstanceOf(FeatureOverrideConflictError);
    expect(store.get('rss', key)).toMatchObject({ patch: { maxItems: 1 }, revision: 1 });
    updateAffects = undefined;
    // Two processes insert the same new key: the loser sees a unique violation.
    insertError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    await expect(store.write({ plugin: 'rss', key: 'qq/bot-1/group:2', next: () => ({ patch: { maxItems: 3 } }) }))
      .rejects.toBeInstanceOf(FeatureOverrideConflictError);
    insertError = new Error('disk full');
    await expect(store.write({ plugin: 'rss', key: 'qq/bot-1/group:2', next: () => ({ patch: { maxItems: 3 } }) })).rejects.toThrow('disk full');
  });

  it.skipIf(!sqliteAvailable)('refresh picks up other processes\' writes, throttled', async () => {
    const db = await sqlite();
    const host = await db.open();
    let now = 1_000_000;
    const mine = new FeatureOverrideStore({ database: host, now: () => now });
    const other = new FeatureOverrideStore({ database: host });
    await mine.load(); await other.load();
    await other.write({ plugin: 'rss', key, next: () => ({ enabled: false, patch: {} }) });
    await mine.refresh();
    expect(mine.get('rss', key)).toBeUndefined(); // within the throttle window
    const version = mine.version;
    now += 10_000;
    await mine.refresh();
    expect(mine.get('rss', key)).toMatchObject({ enabled: false, revision: 1 });
    expect(mine.version).toBe(version + 1);
    now += 10_000;
    await mine.refresh();
    expect(mine.version).toBe(version + 1); // unchanged content keeps the caches
    await host.stop();
  });

  it.skipIf(!sqliteAvailable)('writes through to the database and loads it again at start', async () => {
    const db = await sqlite();
    const first = await db.open();
    const store = new FeatureOverrideStore({ database: first });
    await store.load();
    expect(store.persistent).toBe(true);
    await store.write({ plugin: 'repeater', key, next: () => ({ enabled: false, patch: { threshold: 4, nested: { a: [1, 2] } } }), updatedBy: 'chat:qq:42' });
    await store.write({ plugin: 'rss', key: 'qq/bot-1/private:u%2F1', next: () => ({ enabled: false, patch: {} }) });
    await store.write({ plugin: 'rss', key: 'qq/bot-1/private:u%2F1', next: () => null });
    await first.stop();

    const second = await db.open();
    const reloaded = new FeatureOverrideStore({ database: second });
    await reloaded.load();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.get('repeater', key)).toMatchObject({ enabled: false, patch: { threshold: 4, nested: { a: [1, 2] } }, revision: 1, updatedBy: 'chat:qq:42' });
    // Another process changed the row behind this cache: the write fails and the cache reloads.
    await second.models.get(FEATURE_OVERRIDE_TABLE)!.update({ revision: 7 }).where({ plugin: 'repeater' });
    await expect(reloaded.write({ plugin: 'repeater', key, next: () => null })).rejects.toBeInstanceOf(FeatureOverrideConflictError);
    expect(reloaded.get('repeater', key)?.revision).toBe(7);
    expect(await reloaded.write({ plugin: 'repeater', key, expectedRevision: 7, next: () => null })).toMatchObject({ status: 'saved' });
    await second.stop();
  });
});
