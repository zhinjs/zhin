import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { sqliteAvailable } from '../../../../basic/cli/tests/plugin-runtime/sqlite-availability.js';
import { PluginDatabaseHost, rootPluginId } from 'zhin.js';
import { defineLedgerTables, LedgerStore, USER_TABLE } from '../src/store.js';

it.skipIf(!sqliteAvailable)('upgrades a populated legacy ledger table and preserves report locale after reopening SQLite', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ledger-locale-'));
  const config = { dialect: 'sqlite' as const, filename: join(folder, 'state.sqlite') };
  let host = createDatabaseHost(config);
  let database = new PluginDatabaseHost(rootPluginId(), host);
  try {
    defineLedgerTables({ define(name, definition) {
      const legacy = { ...definition };
      if (name === USER_TABLE) delete legacy.report_locale;
      database.define(name, legacy);
    } });
    await host.start();
    await database.models.get(USER_TABLE)!.insert({ owner_key: 'old', next_seq: 2,
      report_enabled: 1, report_target: '', last_report_date: '2026-10-25' });
    await host.stop();
    host = createDatabaseHost(config); database = new PluginDatabaseHost(rootPluginId(), host);
    defineLedgerTables(database); await host.start();
    const store = new LedgerStore(database);
    expect(await store.getUser('old')).toMatchObject({ nextSeq: 2, reportLocale: 'zh-CN', reportEnabled: true });
    await store.setReport('new', true, undefined, '', 'en');
    await host.stop();
    host = createDatabaseHost(config); database = new PluginDatabaseHost(rootPluginId(), host);
    defineLedgerTables(database); await host.start();
    expect(await new LedgerStore(database).getUser('new')).toMatchObject({ reportLocale: 'en', reportEnabled: true });
    expect(await new LedgerStore(database).getUser('old')).toMatchObject({ nextSeq: 2, reportLocale: 'zh-CN' });
  } finally { await host.stop(); await rm(folder, { recursive: true, force: true }); }
});
