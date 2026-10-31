import { randomUUID } from 'node:crypto';
import { createDatabaseHost, type DatabaseHostConfig } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { PluginDatabaseHost } from '../src/database-host.js';
import { childPluginId, rootPluginId } from '../src/identity.js';
import {
  createRelationalTargetMigration,
  TargetMigrationScopes,
  targetMigrationDigest,
} from '../src/relational-target-migration.js';

const target = { endpoint: { adapter: 'synthetic', id: 'canonical\0account' }, kind: 'group' as const,
  id: 'group\0room', parent: { kind: 'channel' as const, id: 'guild\0parent' }, threadId: 'topic\0thread' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(['before-pause', 'after-pause'] as const)(
  'drains nested accepted work that outlives its parent (%s)',
  async (timing) => {
    const scopes = new TargetMigrationScopes({ pending: () => false });
    const parentEntered = deferred(), startNested = deferred(), nestedEntered = deferred(), held = deferred();
    const persisted = deferred(), completed = vi.fn();
    let nested: Promise<void> | undefined;
    let maintenance: Promise<void> | undefined;
    const parent = scopes.run({ scope: 'selected', run: async () => {
      parentEntered.resolve();
      await startNested.promise;
      nested = scopes.run({ scope: 'selected', run: async () => {
        nestedEntered.resolve();
        await held.promise;
      } });
      await nestedEntered.promise;
    } });
    try {
      await parentEntered.promise;
      if (timing === 'before-pause') { startNested.resolve(); await parent; }
      maintenance = scopes.pause({ planId: 'plan', scopes: ['selected'], persist: async () => persisted.resolve() })
        .then(completed);
      await persisted.promise;
      if (timing === 'after-pause') { startNested.resolve(); await parent; }
      // Allow pause's original promise snapshot to settle without releasing the nested operation.
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(scopes.drained(['selected'])).toBe(false);
      expect(completed).not.toHaveBeenCalled();
      await expect(scopes.run({ scope: 'selected', run: async () => undefined }))
        .rejects.toMatchObject({ code: 'unavailable' });
      await expect(scopes.run({ scope: 'unrelated', run: async () => 'available' })).resolves.toBe('available');
      held.resolve();
      await nested;
      await maintenance;
      expect(scopes.drained(['selected'])).toBe(true);
      expect(completed).toHaveBeenCalledOnce();
    } finally {
      startNested.resolve(); held.resolve();
      await parent;
      await nested;
      await maintenance;
    }
  },
);

async function createFixture(connection: DatabaseHostConfig) {
  const host = createDatabaseHost(connection);
  const owner = connection.dialect === 'pg' ? childPluginId(rootPluginId(), `p${randomUUID().slice(0, 8)}`) : rootPluginId();
  const db = new PluginDatabaseHost(owner, host);
  db.define('sessions', {
    id: { type: 'text', primary: true },
    scope: { type: 'text', nullable: false },
    state_json: { type: 'text', nullable: false },
    revision: { type: 'integer', nullable: false },
  });
  const build = () => {
    const scopes = new TargetMigrationScopes({ pending: () => false });
    const provider = createRelationalTargetMigration({
      database: db,
      scopes,
      domain: 'game:synthetic',
      title: 'Synthetic',
      sourceVersion: 'alias-v0',
      tables: ['sessions'],
      async readUnits(reader) {
        const rows = await reader.model('sessions').select().where({ scope: 'legacy' });
        return rows.length
          ? [
              {
                id: 'legacy-unit',
                scope: 'legacy',
                title: 'Legacy',
                status: 'unresolved' as const,
                records: [{ table: 'sessions', query: { scope: 'legacy' }, rows }],
                summary: {},
              },
            ]
          : [];
      },
      rewrite(unit, destination) {
        const before = unit.records[0]!,
          scope = `canonical:${JSON.stringify(destination)}`,
          patch = { scope };
        return {
          destinationScope: scope,
          writes: [
            {
              before,
              after: { table: 'sessions', query: { scope }, rows: before.rows.map((row) => ({ ...row, ...patch })) },
              patch,
            },
          ],
        };
      },
    });
    return { scopes, provider };
  };
  const initial = build();
  await host.start();
  await db.models
    .get('sessions')!
    .insert({
      id: 'game',
      scope: 'legacy',
      state_json: JSON.stringify({ turn: 'alice', random: 123, detail: 'x'.repeat(70_000) }),
      revision: 7,
    });
  const makePlan = async () => {
    const candidate = (await initial.provider.preview()).candidates[0]!;
    return initial.provider.prepare({
      planId: 'plan',
      candidateId: candidate.id,
      expectedDigest: candidate.beforeDigest,
      target,
    });
  };
  return { host, db, ...initial, makePlan, restart: build, destination: `canonical:${JSON.stringify(target)}` };
}

const connections: Array<{ name: string; config: DatabaseHostConfig }> = [
  { name: 'SQLite', config: { dialect: 'sqlite', filename: ':memory:' } },
];
// Reuse the repository's explicit external-database acceptance switch; the default remains offline SQLite.
if (process.env.ZHIN_TEST_EXTERNAL_DATABASES === '1') connections.push({ name: 'PostgreSQL', config: {
  dialect: 'pg', host: process.env.ZHIN_TEST_PG_HOST ?? '127.0.0.1',
  port: Number(process.env.ZHIN_TEST_PG_PORT ?? 35432), user: process.env.ZHIN_TEST_PG_USER ?? 'zhin',
  password: process.env.ZHIN_TEST_PG_PASSWORD ?? 'zhin', database: process.env.ZHIN_TEST_PG_DATABASE ?? 'zhin_test',
} });

describe.each(connections)('$name target migration', ({ config }) => {
  const fixture = () => createFixture(config);

  it('keeps data and migration journals isolated between Plugin owners', async () => {
    const first = await fixture(), second = await fixture();
    try {
      const unchanged = await second.db.models.get('sessions')!.select();
      const plan = await first.makePlan();
      expect(plan.target).toEqual(target);
      await first.provider.apply({ plan });
      expect(await first.db.models.get('sessions')!.select()).toEqual(unchanged.map(row => ({ ...row, scope: first.destination })));
      expect(await second.db.models.get('sessions')!.select()).toEqual(unchanged);
      const independent = await second.makePlan();
      await second.provider.apply({ plan: independent });
      await second.provider.restore({ plan: independent, receipt: (await second.provider.inspect({ plan: independent })).receipt! });
      expect(await second.db.models.get('sessions')!.select()).toEqual(unchanged);
      expect(await first.provider.inspect({ plan })).toMatchObject({ data: 'applied', maintenance: 'paused' });
    } finally { await Promise.all([first.host.stop(), second.host.stop()]); }
  });

  it('waits for accepted nested writes before checking the actual migration before-images', async () => {
    const f = await fixture(), entered = deferred(), held = deferred();
    let nested: Promise<void> | undefined;
    let application: Promise<unknown> | undefined;
    try {
      const plan = await f.makePlan(), before = await f.db.models.get('sessions')!.select();
      await f.scopes.run({ scope: 'legacy', run: async () => {
        nested = f.scopes.run({ scope: 'legacy', run: async () => {
          entered.resolve();
          await held.promise;
          await f.db.models.get('sessions')!.update({ revision: 8 }).where({ id: 'game' });
        } });
        await entered.promise;
      } });
      application = f.provider.apply({ plan }).catch(error => error);
      await vi.waitFor(() => expect(f.scopes.maintenance(plan.id, ['legacy', f.destination])).toBe('paused'));
      // Inspection cannot claim a settled maintenance outcome while apply itself is in flight.
      expect(await f.provider.inspect({ plan })).toMatchObject({ data: 'unknown', maintenance: 'unknown', resumable: false });
      expect(await f.db.models.get('sessions')!.select()).toEqual(before);
      held.resolve();
      await nested;
      await expect(application).resolves.toMatchObject({ code: 'conflict' });
      expect(await f.db.models.get('sessions')!.select()).toEqual(before.map(row => ({ ...row, revision: 8 })));
      expect(await f.provider.inspect({ plan })).toMatchObject({ data: 'not_applied', maintenance: 'paused' });
    } finally {
      held.resolve();
      await nested;
      await application;
      await f.host.stop();
    }
  });

  it('commits a complete large plan atomically, drains only its scopes, and restores paused admission after restart', async () => {
    const f = await fixture(),
      held = deferred(),
      entered = deferred();
    try {
      const before = await f.db.models.get('sessions')!.select(),
        plan = await f.makePlan();
      expect(JSON.stringify(plan.data).length).toBeGreaterThan(64 * 1024);
      expect(await f.db.models.get('sessions')!.select()).toEqual(before);
      const work = f.scopes.run({
        scope: 'legacy',
        run: async () => {
          entered.resolve();
          await held.promise;
        },
      });
      await entered.promise;
      const applying = f.provider.apply({ plan });
      await vi.waitFor(async () => expect((await f.provider.inspect({ plan })).data).toBe('unknown'));
      await expect(f.scopes.run({ scope: f.destination, run: async () => undefined })).rejects.toMatchObject({
        code: 'unavailable',
      });
      await expect(f.scopes.run({ scope: 'another-scene', run: async () => 'unaffected' })).resolves.toBe('unaffected');
      expect(await f.db.models.get('sessions')!.select()).toEqual(before);
      held.resolve();
      await work;
      const receipt = await applying;
      expect(receipt).toMatchObject({ operation: 'apply', maintenance: 'paused' });
      const after = await f.db.models.get('sessions')!.select();
      expect(after).toEqual(before.map((row) => ({ ...row, scope: f.destination })));
      const restored = f.restart();
      await expect(restored.scopes.run({ scope: f.destination, run: async () => undefined })).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(await restored.provider.inspect({ plan })).toMatchObject({
        data: 'applied',
        maintenance: 'paused',
        receipt,
      });
      await restored.provider.resume({ plan });
      await expect(restored.scopes.run({ scope: f.destination, run: async () => 'allowed' })).resolves.toBe('allowed');
      expect(await restored.provider.inspect({ plan })).toMatchObject({ data: 'applied', maintenance: 'resumed' });
      const reverted = await restored.provider.restore({ plan, receipt });
      expect(reverted.operation).toBe('restore');
      expect(await f.db.models.get('sessions')!.select()).toEqual(before);
      expect(await restored.provider.inspect({ plan })).toMatchObject({
        data: 'restored',
        maintenance: 'paused',
        receipt: reverted,
      });
    } finally {
      held.resolve();
      await f.host.stop();
    }
  });

  it('keeps a rejected application paused and permits explicit resumption only against its confirmed rejection baseline', async () => {
    const f = await fixture();
    try {
      const plan = await f.makePlan();
      await f.db.models.get('sessions')!.update({ revision: 8 }).where({ id: 'game' });
      const changed = await f.db.models.get('sessions')!.select();
      await expect(f.provider.apply({ plan })).rejects.toMatchObject({ code: 'conflict' });
      expect(await f.db.models.get('sessions')!.select()).toEqual(changed);
      expect(await f.provider.inspect({ plan })).toEqual({ data: 'not_applied', maintenance: 'paused', resumable: true });
      await f.provider.resume({ plan });
      expect(await f.provider.inspect({ plan })).toEqual({
        data: 'not_applied',
        maintenance: 'resumed',
        resumable: false,
      });
    } finally {
      await f.host.stop();
    }
  });

  it('refuses reversal after gameplay changed, preserving both business rows and the prior committed receipt', async () => {
    const f = await fixture();
    try {
      const plan = await f.makePlan(),
        receipt = await f.provider.apply({ plan });
      await f.provider.resume({ plan });
      await f.db.models.get('sessions')!.update({ revision: 8 }).where({ id: 'game' });
      const changed = await f.db.models.get('sessions')!.select();
      await expect(f.provider.restore({ plan, receipt })).rejects.toMatchObject({ code: 'conflict' });
      expect(await f.db.models.get('sessions')!.select()).toEqual(changed);
      expect(await f.provider.inspect({ plan })).toMatchObject({
        data: 'conflict',
        maintenance: 'paused',
        resumable: true,
      });
      await f.provider.resume({ plan });
      expect(await f.db.models.get('sessions')!.select()).toEqual(changed);
      expect(await f.provider.inspect({ plan })).toMatchObject({
        data: 'conflict',
        maintenance: 'resumed',
        resumable: false,
      });
    } finally {
      await f.host.stop();
    }
  });

  it('hashes data independently of object-key order, and never coerces undefined into a missing field', () => {
    expect(targetMigrationDigest({ b: 1, a: 2 })).toBe(targetMigrationDigest({ a: 2, b: 1 }));
    expect(() => targetMigrationDigest({ a: undefined })).toThrow('lossless');
  });

  it('reports a real in-memory pause when the first intent transaction fails, then explicitly persists and resumes', async () => {
    const f = await fixture();
    try {
      const plan = await f.makePlan();
      const failing = vi.spyOn(f.db, 'transaction').mockRejectedValueOnce(new Error('intent transaction unavailable'));
      await expect(f.provider.apply({ plan })).rejects.toThrow('intent transaction unavailable');
      failing.mockRestore();
      expect(await f.provider.inspect({ plan })).toMatchObject({
        data: 'not_applied',
        maintenance: 'paused',
        resumable: true,
      });
      await expect(f.scopes.run({ scope: f.destination, run: async () => undefined })).rejects.toMatchObject({
        code: 'unavailable',
      });
      await f.provider.resume({ plan });
      expect(await f.provider.inspect({ plan })).toMatchObject({
        data: 'not_applied',
        maintenance: 'resumed',
        resumable: false,
      });
      await expect(f.scopes.run({ scope: f.destination, run: async () => 'resumed' })).resolves.toBe('resumed');
    } finally {
      await f.host.stop();
    }
  });

  it.each(['apply', 'restore'] as const)(
    'inspects a committed %s whose response was lost, without replaying the operation',
    async (operation) => {
      const f = await fixture();
      try {
        const plan = await f.makePlan();
        const first = operation === 'restore' ? await f.provider.apply({ plan }) : undefined;
        const transact = f.db.transaction.bind(f.db);
        let calls = 0;
        const spy = vi.spyOn(f.db, 'transaction').mockImplementation(async (callback) => {
          const result = await transact(callback);
          calls += 1;
          if (calls === 2) throw new Error('synthetic response lost after commit');
          return result;
        });
        const request =
          operation === 'restore' ? f.provider.restore({ plan, receipt: first! }) : f.provider.apply({ plan });
        await expect(request).rejects.toThrow('response lost');
        spy.mockRestore();
        expect(await f.provider.inspect({ plan })).toMatchObject({
          data: operation === 'restore' ? 'restored' : 'applied',
          maintenance: 'paused',
          resumable: true,
          receipt: { operation },
        });
        expect((await f.db.models.get('sessions')!.select())[0]!.scope).toBe(
          operation === 'restore' ? 'legacy' : f.destination,
        );
      } finally {
        await f.host.stop();
      }
    },
  );

  it('preserves a receipt lookup failure as an error instead of reporting that no commit occurred', async () => {
    const f = await fixture();
    try {
      const plan = await f.makePlan();
      const spy = vi.spyOn(f.db, 'transaction').mockRejectedValueOnce(new Error('synthetic inspection unavailable'));
      await expect(f.provider.inspect({ plan })).rejects.toThrow('inspection unavailable');
      spy.mockRestore();
      expect(await f.provider.inspect({ plan })).toMatchObject({ data: 'not_applied', maintenance: 'resumed' });
    } finally {
      await f.host.stop();
    }
  });

  it('does not offer resumption after intent persistence failed while previously admitted scope work is still running', async () => {
    const f = await fixture(), held = deferred(), entered = deferred();
    try {
      const plan = await f.makePlan();
      const work = f.scopes.run({ scope: f.destination, run: async () => { entered.resolve(); await held.promise; } }); await entered.promise;
      const spy = vi.spyOn(f.db, 'transaction').mockRejectedValueOnce(new Error('synthetic intent unavailable'));
      await expect(f.provider.apply({ plan })).rejects.toThrow('intent unavailable'); spy.mockRestore();
      expect(await f.provider.inspect({ plan })).toMatchObject({ data: 'unknown', maintenance: 'paused', resumable: false });
      await expect(f.provider.resume({ plan })).rejects.toMatchObject({ code: 'conflict' });
      await expect(f.scopes.run({ scope: f.destination, run: async () => undefined })).rejects.toMatchObject({ code: 'unavailable' });
      held.resolve(); await work;
      expect(await f.provider.inspect({ plan })).toMatchObject({ data: 'not_applied', maintenance: 'paused', resumable: true });
      await f.provider.resume({ plan });
      expect(await f.provider.inspect({ plan })).toMatchObject({ maintenance: 'resumed', resumable: false });
    } finally { held.resolve(); await f.host.stop(); }
  });

  it('releases a failed readonly initialization so the next explicit request can read the journal again', async () => {
    const f = await fixture();
    try {
      const { qualifyPluginResourceName } = await import('../src/database-host.js');
      const journal = f.host.models.get(qualifyPluginResourceName(f.db.owner, 'target_migration_journal'))!;
      const select = vi.spyOn(journal, 'select').mockImplementationOnce(() => { throw new Error('synthetic readonly lookup outage'); });
      await expect(f.scopes.run({ scope: 'another-scene', run: async () => 'allowed' })).rejects.toThrow('lookup outage');
      await expect(f.scopes.run({ scope: 'another-scene', run: async () => 'allowed' })).resolves.toBe('allowed');
      expect(select).toHaveBeenCalledTimes(2); expect(await journal.select()).toHaveLength(0);
    } finally { await f.host.stop(); }
  });
});
