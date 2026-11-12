import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { isGatewayOwnedTable } from '@zhin.js/database';
import {
  FEATURE_CONVERSATION_TABLE, FeatureConversationConflictError, FeatureConversationOverrideStore, defineFeatureConversationTable,
} from '../../../src/instance/console/feature-conversation-store.js';
import { CHAT_ROLE_TABLE, defineChatRoleTable } from '../../../src/instance/chat-roles.js';
import { sqliteAvailable } from '../sqlite-availability.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function sqlite() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-feature-store-'));
  directories.push(directory);
  const open = async () => {
    const host = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'bot.db') });
    defineFeatureConversationTable(host);
    defineChatRoleTable(host);
    await host.start();
    return host;
  };
  return { open };
}

const key = 'qq/bot-1/group:1001';

describe('feature_conversation_overrides store', () => {
  it('uses instance-owned table names outside the gateway console_ namespace', () => {
    expect(isGatewayOwnedTable(FEATURE_CONVERSATION_TABLE)).toBe(false);
    expect(isGatewayOwnedTable(CHAT_ROLE_TABLE)).toBe(false);
  });

  it('keeps overrides in memory without a relational database and bumps the version per write', async () => {
    const store = new FeatureConversationOverrideStore();
    await store.load();
    expect(store.persistent).toBe(false);
    const before = store.reader.version;
    const saved = await store.write({ plugin: 'repeater', key, next: () => ({ patch: { threshold: 5 } }), updatedBy: 'user:1' });
    expect(saved).toMatchObject({ status: 'saved', revision: 1 });
    expect(store.reader.version).toBe(before + 1);
    expect(store.reader.get('repeater', key)).toMatchObject({ patch: { threshold: 5 }, revision: 1, updatedBy: 'user:1' });
    expect(Object.isFrozen(store.get('repeater', key)!.patch)).toBe(true);
    expect(await store.write({ plugin: 'repeater', key, next: current => ({ patch: current!.patch }) })).toMatchObject({ status: 'unchanged' });
    expect(store.reader.version).toBe(before + 1);
  });

  it('rejects a stale expected revision (optimistic concurrency)', async () => {
    const store = new FeatureConversationOverrideStore();
    await store.write({ plugin: 'rss', key, expectedRevision: 0, next: () => ({ enabled: false, patch: {} }) });
    expect(await store.write({ plugin: 'rss', key, expectedRevision: 0, next: () => null })).toEqual({ status: 'conflict', revision: 1 });
    expect(await store.write({ plugin: 'rss', key, expectedRevision: 1, next: () => null })).toMatchObject({ status: 'saved', revision: 0 });
    expect(store.get('rss', key)).toBeUndefined();
  });

  it.skipIf(!sqliteAvailable)('writes through to the database and loads it again at start', async () => {
    const db = await sqlite();
    const first = await db.open();
    const store = new FeatureConversationOverrideStore({ database: first });
    await store.load();
    expect(store.persistent).toBe(true);
    await store.write({ plugin: 'repeater', key, next: () => ({ enabled: false, patch: { threshold: 4, nested: { a: [1, 2] } } }), updatedBy: 'chat:qq:42' });
    await store.write({ plugin: 'rss', key: 'qq/bot-1/private:u%2F1', next: () => ({ enabled: false, patch: {} }) });
    await store.write({ plugin: 'rss', key: 'qq/bot-1/private:u%2F1', next: () => null });
    await first.stop();

    const second = await db.open();
    const reloaded = new FeatureConversationOverrideStore({ database: second });
    await reloaded.load();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.get('repeater', key)).toMatchObject({ enabled: false, patch: { threshold: 4, nested: { a: [1, 2] } }, revision: 1, updatedBy: 'chat:qq:42' });
    // Another process changed the row behind this cache: the write fails and the cache reloads.
    await second.models.get(FEATURE_CONVERSATION_TABLE)!.update({ revision: 7 }).where({ plugin: 'repeater' });
    await expect(reloaded.write({ plugin: 'repeater', key, next: () => null })).rejects.toBeInstanceOf(FeatureConversationConflictError);
    expect(reloaded.get('repeater', key)?.revision).toBe(7);
    expect(await reloaded.write({ plugin: 'repeater', key, expectedRevision: 7, next: () => null })).toMatchObject({ status: 'saved' });
    await second.stop();
  });
});
