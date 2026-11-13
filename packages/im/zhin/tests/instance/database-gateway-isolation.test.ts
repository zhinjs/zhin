import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost, normalizeDatabaseHostConfig } from '@zhin.js/core/runtime';
import { openGatewayStore } from '@zhin.js/gateway/database';
import { IAM_TABLES } from '@zhin.js/gateway/iam';

/**
 * ADR 0059 §1 / §2 / §5 on SQLite: the owner's raw Console SQL reaches neither read nor write of
 * the gateway's accounts — with the Console's text checks on, and with them off (the storage
 * boundary alone: another file the instance connection cannot ATTACH).
 */
const HASH = 'scrypt$secret-password-hash';

describe.each([true, false])('owner raw SQL on SQLite (text guard %s)', (textGuard) => {
  it('cannot read or change gateway.db', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-isolation-'));
    const store = await openGatewayStore(root);
    await store.models.get(IAM_TABLES.users)!.insert({
      id: 'u1', username: 'alice', display_name: 'Alice', password_hash: HASH,
      disabled: 0, password_changed_at: 1, created_at: 1, updated_at: 1,
    });
    const host = createDatabaseHost(normalizeDatabaseHostConfig({ dialect: 'sqlite', filename: join(root, '.zhin', 'data.sqlite') }), { textGuard });
    host.define('notes', { id: { type: 'integer', primary: true } });
    const attempts: Array<() => Promise<unknown>> = [
      () => host.console!.query!(`SELECT password_hash FROM ${IAM_TABLES.users}`),
      () => host.console!.execute!(`ATTACH DATABASE '${store.filename}' AS g`),
      () => host.console!.query!(`SELECT password_hash FROM g.${IAM_TABLES.users}`),
      () => host.console!.execute!(`UPDATE g.${IAM_TABLES.users} SET password_hash = 'x'`),
      () => host.console!.execute!(`ATTACH DATABASE '${store.filename}' AS g; UPDATE g.${IAM_TABLES.users} SET password_hash = 'x'`),
      () => host.console!.query!(`SELECT * FROM pragma_database_list`),
    ];
    try {
      await host.start();
      expect(host.console!.info().capabilities).toMatchObject({ sql: true, sqlIsolation: 'separate-store' });
      for (const [index, attempt] of attempts.entries()) {
        const outcome = await attempt().then(result => ({ result }), (error: unknown) => ({ error }));
        expect(JSON.stringify(outcome), `attempt ${index}`).not.toContain(HASH);
        if (index < 5) expect(outcome, `attempt ${index}`).toHaveProperty('error');
        if (!textGuard) {
          // Nothing but the storage boundary stopped these.
          const message = String((outcome as { error?: unknown }).error);
          if (index === 0) expect(message).toMatch(/no such table/);
          if (index === 1 || index === 4) expect(message).toMatch(/ATTACH DATABASE is not allowed/);
          if (index === 2 || index === 3) expect(message).toMatch(/no such table/);
        }
      }
      // The instance connection has nothing attached, and gateway.db is unchanged.
      const listed = await host.console!.query!('SELECT name FROM pragma_database_list');
      expect(listed.rows).toEqual([{ name: 'main' }]);
      expect(await store.query(`SELECT password_hash FROM ${IAM_TABLES.users}`)).toEqual([{ password_hash: HASH }]);
      // Instance tables keep working.
      expect((await host.console!.execute!('INSERT INTO notes (id) VALUES (1)')).statements).toHaveLength(1);
    } finally {
      await host.stop();
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
