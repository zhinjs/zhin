import { createDatabaseHost } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { PluginDatabaseHost, rootPluginId, TargetMigrationScopes, decodeTaskTarget } from 'zhin.js/plugin-runtime';
import { createSubscriptionTargetMigration } from '../src/target-migration.js';
import { BILI_STATE_TABLE, BILI_SUBS_TABLE, defineBiliTables } from '../src/store.js';

it('migrates a keyless Bilibili destination group atomically without resetting its live/dynamic cursor', async () => {
  const host = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' }),
    database = new PluginDatabaseHost(rootPluginId(), host);
  defineBiliTables(database);
  const scopes = new TargetMigrationScopes({ pending: (key) => key.startsWith('historical:') });
  const provider = createSubscriptionTargetMigration({ database, scopes });
  await host.start();
  try {
    const Subs = database.models.get(BILI_SUBS_TABLE)!,
      State = database.models.get(BILI_STATE_TABLE)!;
    const old = {
      uid: '1',
      uname: 'UP',
      kinds: 'all',
      adapter_name: 'icqq',
      endpoint_id: 'same-alias',
      channel_type: 'group',
      channel_id: 'room',
      creator_id: 'alice',
      created_at: '2026-01-01',
      locale: 'en',
    };
    await Subs.insert(old);
    await Subs.insert(old);
    await State.insert({
      uid: '1',
      live_status: 1,
      live_time: 123,
      last_dynamic_ts: 456,
      seen_dynamics: '["seen"]',
      dynamic_ready: 1,
      updated_at: '2026-01-01',
    });
    const cursor = await State.select(),
      oldRows = await Subs.select();
    const target = {
      endpoint: { adapter: 'icqq', id: 'canonical\0selected-account' },
      kind: 'group' as const,
      id: 'room',
    };
    const candidate = (await provider.preview()).candidates[0]!;
    expect(candidate.recordCount).toBe(2);
    const plan = await provider.prepare({
      planId: 'bili-plan',
      candidateId: candidate.id,
      expectedDigest: candidate.beforeDigest,
      target,
    });
    const receipt = await provider.apply({ plan });
    expect(receipt.operation).toBe('apply');
    const rows = await Subs.select();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(decodeTaskTarget(JSON.parse(String(row.target_json)))).toEqual(target);
      expect(row).toMatchObject({
        uid: old.uid,
        uname: old.uname,
        kinds: old.kinds,
        creator_id: old.creator_id,
        created_at: old.created_at,
        locale: old.locale,
      });
      expect(String(row.endpoint_id)).not.toContain('\0');
    }
    expect(await State.select()).toEqual(cursor);
    await provider.resume({ plan });
    await provider.restore({ plan, receipt });
    expect(await Subs.select()).toEqual(oldRows);
    expect(await State.select()).toEqual(cursor);
    expect(await provider.inspect({ plan })).toMatchObject({
      data: 'restored',
      maintenance: 'paused',
      resumable: true,
    });
  } finally {
    await host.stop();
  }
});
