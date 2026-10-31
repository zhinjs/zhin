import { createDatabaseHost } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { PluginDatabaseHost, rootPluginId, TargetMigrationScopes } from 'zhin.js/plugin-runtime';
import { createEarthquakeTargetMigration } from '../src/target-migration.js';
import { SubscriptionStore, subscriptionKey, SUBSCRIPTIONS_STATE_KEY } from '../src/subscriptions.js';

const target = { endpoint: { adapter: 'synthetic', id: 'canonical\0account' }, kind: 'group' as const, id: 'room' };
const legacy = {
  adapter: 'synthetic',
  endpointKey: 'reusable-alias',
  conversationKind: 'group' as const,
  conversationId: 'room',
  minMagnitude: 5,
  regions: ['四川'],
  createdBy: 'alice',
  createdAt: '2026-01-01',
  locale: 'en' as const,
};
async function fixture() {
  const host = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' }),
    database = new PluginDatabaseHost(rootPluginId(), host);
  const state = database.state;
  const build = () => {
    const scopes = new TargetMigrationScopes({ pending: (key) => !key.startsWith('canonical:') });
    const provider = createEarthquakeTargetMigration({ database, state, scopes });
    const store = new SubscriptionStore(state, { maxSubscriptions: 100 });
    store.bindMigrationScopes(scopes);
    return { scopes, provider, store };
  };
  const original = build();
  await host.start();
  await state.set(SUBSCRIPTIONS_STATE_KEY, [legacy]);
  const candidate = (await original.provider.preview()).candidates[0]!;
  const plan = await original.provider.prepare({
    planId: 'earthquake-plan',
    candidateId: candidate.id,
    expectedDigest: candidate.beforeDigest,
    target,
  });
  return { host, state, ...original, plan, restart: build };
}

it('atomically binds only the selected earthquake subscription, preserves other scope updates and restores pause after restart', async () => {
  const f = await fixture();
  try {
    const receipt = await f.provider.apply({ plan: f.plan });
    const migrated = {
      ...legacy,
      target,
      adapter: target.endpoint.adapter,
      endpointKey: target.endpoint.id,
      conversationKind: target.kind,
      conversationId: target.id,
    };
    expect(await f.store.list()).toEqual([migrated]);
    const other = {
      ...legacy,
      target: { ...target, id: 'other' },
      endpointKey: target.endpoint.id,
      conversationId: 'other',
      minMagnitude: 6,
    };
    await f.store.upsert(other);
    expect(await f.provider.inspect({ plan: f.plan })).toMatchObject({
      data: 'applied',
      maintenance: 'paused',
      resumable: true,
    });
    const restarted = f.restart();
    await expect(restarted.store.remove(subscriptionKey(migrated))).rejects.toMatchObject({ code: 'unavailable' });
    await restarted.provider.resume({ plan: f.plan });
    await restarted.store.upsert({ ...other, minMagnitude: 7 });
    const reverted = await restarted.provider.restore({ plan: f.plan, receipt });
    expect(reverted.operation).toBe('restore');
    expect(await restarted.store.list()).toEqual([legacy, { ...other, minMagnitude: 7 }]);
    expect(await restarted.provider.inspect({ plan: f.plan })).toMatchObject({
      data: 'restored',
      maintenance: 'paused',
    });
  } finally {
    await f.host.stop();
  }
});

it('reconciles an atomic state commit whose response was lost without reapplying it', async () => {
  const f = await fixture();
  try {
    const update = f.state.update.bind(f.state);
    let calls = 0;
    const spy = vi.spyOn(f.state, 'update').mockImplementation(async (...args) => {
      const result = await update(...args);
      calls += 1;
      if (calls === 2) throw new Error('synthetic response lost after CAS');
      return result;
    });
    await expect(f.provider.apply({ plan: f.plan })).rejects.toThrow('response lost');
    spy.mockRestore();
    const inspection = await f.provider.inspect({ plan: f.plan });
    expect(inspection).toMatchObject({ data: 'applied', maintenance: 'paused', receipt: { operation: 'apply' } });
    expect(await f.store.list()).toHaveLength(1);
    await f.provider.resume({ plan: f.plan });
    expect(await f.provider.inspect({ plan: f.plan })).toMatchObject({ data: 'applied', maintenance: 'resumed' });
  } finally {
    await f.host.stop();
  }
});

it('does not overwrite an edited migrated subscription when restoration is rejected', async () => {
  const f = await fixture();
  try {
    const receipt = await f.provider.apply({ plan: f.plan });
    await f.provider.resume({ plan: f.plan });
    const [subscription] = await f.store.list();
    await f.store.upsert({ ...subscription!, minMagnitude: 8 });
    await expect(f.provider.restore({ plan: f.plan, receipt })).rejects.toMatchObject({ code: 'conflict' });
    expect((await f.store.list())[0]!.minMagnitude).toBe(8);
    expect(await f.provider.inspect({ plan: f.plan })).toMatchObject({
      data: 'conflict',
      maintenance: 'paused',
      resumable: true,
    });
    await f.provider.resume({ plan: f.plan });
    expect((await f.store.list())[0]!.minMagnitude).toBe(8);
  } finally {
    await f.host.stop();
  }
});
