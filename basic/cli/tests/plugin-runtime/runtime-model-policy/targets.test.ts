import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapterFeatureId } from '@zhin.js/adapter';
import { CONVERSATION_EVENT_MODEL } from '@zhin.js/im-contract';
import { encodeTaskTarget, rootPluginId, SnapshotStore, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { migrateConversationColumns } from '../../../src/plugin-runtime/conversation-migration.js';
import type { StructuredDatabase } from '@zhin.js/database';
import { createRuntimePolicyTargetsReader } from '../../../src/plugin-runtime/runtime-model-policy/targets.js';

function snapshot(canonicalId = 'canonical\0stable-account'): SnapshotState {
  // Only the new Index's public metadata port is supplied. Live endpoints and platform methods do not exist here.
  const index = { $projection: 'zhin.adapter-index/1', adapters: () => [{
    descriptor: { id: 'root/plugin/adapter/icqq', name: 'icqq', source: 'local', owner: rootPluginId(), capabilities: [] },
    list: () => [{ instanceId: 'stable-account-id', canonicalId, endpointId: 'configured-account-name', revision: 1, desiredEnabled: false, epoch: 0, started: false, admitted: false }],
  }] };
  return { root: rootPluginId(), tree: new Map(), config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map([[adapterFeatureId, index]]) };
}

it('selects only distinct complete conversation addresses with SQL pagination, never event bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-policy-targets-'));
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'targets.sqlite') });
  database.define('conversation_events', CONVERSATION_EVENT_MODEL);
  const store = new SnapshotStore(snapshot()); const lease = store.acquire();
  try {
    await database.start(); await migrateConversationColumns(database.getRawDatabase() as StructuredDatabase);
    const events = database.models.get('conversation_events')!;
    const conversation = { endpoint: { adapter: 'actual-sdk-adapter', id: 'canonical\0stable-account' }, kind: 'channel' as const, id: 'room%25\0identity' };
    const insert = async (id: string, target = conversation, extras = {}) => events.insert({ event_id: id,
      conversation_key: id, message_key: '', event_json: 'SYNTHETIC_PRIVATE_MESSAGE_MUST_NOT_BE_READ', time: 1,
      query_version: 1, ...encodeTaskTarget(target), ...extras });
    await insert('duplicate-1'); await insert('duplicate-2');
    await insert('thread', { ...conversation, threadId: 'thread' } as typeof conversation);
    await insert('parent', { ...conversation, parent: { kind: 'channel', id: 'parent' } } as typeof conversation);
    await insert('foreign', { ...conversation, endpoint: { ...conversation.endpoint, id: 'another-account' } });
    const raw = database.getRawDatabase() as StructuredDatabase;
    const query = vi.spyOn(raw, 'query');
    const read = createRuntimePolicyTargetsReader({ rootId: '/host', lease, database });
    const metadata = await read(); expect(metadata.scenesError).toBe('not_requested'); expect(query).not.toHaveBeenCalled();
    expect(metadata.endpoints[0]).toEqual({ capabilityId: 'root/plugin/adapter/icqq', instanceId: 'stable-account-id', address: {
      rootId: '/host', platform: 'icqq', endpoint: 'configured-account-name', adapterId: conversation.endpoint.id } });
    const first = await read({ limit: 2, offset: 0 }), second = await read({ limit: 2, offset: 2 });
    expect(first.scenesAvailable).toBe(true); expect(first.sceneHasMore).toBe(true);
    expect(second.scenesAvailable).toBe(true); expect(second.sceneHasMore).toBe(false);
    const scenes = [...first.scenes, ...second.scenes].map(value => value.address);
    expect(scenes).toHaveLength(3);
    expect(new Set(scenes.map(value => JSON.stringify(value.conversation))).size).toBe(3);
    expect(scenes.every(value => value.platform === 'icqq' && value.endpoint === 'configured-account-name')).toBe(true);
    expect(scenes.every(value => value.conversation.id === conversation.id && value.conversation.endpoint.adapter === 'actual-sdk-adapter')).toBe(true);
    expect(JSON.stringify(scenes)).not.toContain('SYNTHETIC_PRIVATE_MESSAGE');
    expect(query.mock.calls.every(([sql]) => !String(sql).includes('event_json'))).toBe(true);
    expect(query.mock.calls.every(([sql]) => /GROUP BY/iu.test(String(sql)))).toBe(true);
    const [sql, params] = query.mock.calls[0]!;
    const plan = await raw.query(`EXPLAIN QUERY PLAN ${sql}`, params);
    expect(JSON.stringify(plan)).toMatch(/USING COVERING INDEX conversation_events_scope_directory/iu);

    query.mockRejectedValueOnce(new Error('private database detail'));
    const failed = await read({ limit: 2, offset: 0 }); expect(failed.scenesAvailable).toBe(false); expect(failed.scenesError).toBe('unavailable');
  } finally { lease.release(); await store.close(); await database.stop(); await rm(directory, { recursive: true, force: true }); }
});

it('keeps the leased Adapter generation and reports missing source metadata explicitly', async () => {
  const store = new SnapshotStore(snapshot('old-canonical')); const old = store.acquire();
  const readOld = createRuntimePolicyTargetsReader({ rootId: '/host', lease: old });
  store.commit(0, { snapshot: snapshot('new-canonical'), dispose: () => undefined });
  const current = store.acquire();
  try {
    expect((await readOld()).endpoints[0]!.address.adapterId).toBe('old-canonical');
    expect((await createRuntimePolicyTargetsReader({ rootId: '/host', lease: current })()).endpoints[0]!.address.adapterId).toBe('new-canonical');
    expect((await readOld({ limit: 50, offset: 0 })).scenesError).toBe('unavailable');
  } finally { old.release(); current.release(); await store.close(); }
});
