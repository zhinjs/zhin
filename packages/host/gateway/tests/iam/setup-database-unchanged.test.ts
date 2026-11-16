import { describe, expect, it, vi } from 'vitest';
import { LOCAL_GATEWAY_RPC } from '../../src/local/protocol.js';
import { createLocalConsoleAdmin } from '../../src/iam/local-admin.js';
import { ConsoleSetupService, SETUP_NO_MIGRATION_NOTICE } from '../../src/iam/setup-service.js';

/** #1250 console-init-default-db-restart: choosing the database already in use changes nothing. */
function setupWith(document: Record<string, unknown>, environment: Record<string, string> = {}) {
  const setKey = vi.fn(async () => undefined);
  const write = vi.fn(async () => undefined);
  const probe = vi.fn(async () => ({ ok: true as const, latencyMs: 1 }));
  const setup = new ConsoleSetupService({
    projectRoot: '/project',
    config: { readDocument: async () => structuredClone(document), setKey },
    envFile: { read: async () => '', write },
    iam: () => undefined,
    environment: async () => environment,
    probe,
  });
  return { setup, setKey, write, probe };
}

describe('ConsoleSetupService.applyDatabase with the database in use', () => {
  it('writes nothing for the default SQLite when no database block exists', async () => {
    const { setup, setKey, write } = setupWith({ configVersion: 2 });
    expect(await setup.applyDatabase({ dialect: 'sqlite' })).toEqual({ changed: false, restartRequired: false, notice: '' });
    // The wizard's defaults (filename .zhin/data.sqlite, mode wal) are the same database.
    expect(await setup.applyDatabase({ dialect: 'sqlite', connection: { filename: '.zhin/data.sqlite', mode: 'wal' } }))
      .toMatchObject({ changed: false, restartRequired: false });
    expect(await setup.applyDatabase({ dialect: 'sqlite', connection: { filename: './.zhin/data.sqlite' } }))
      .toMatchObject({ changed: false });
    expect(setKey).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps a configured database when only its dialect is chosen again', async () => {
    const { setup, setKey } = setupWith({ database: { dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' } });
    expect(await setup.applyDatabase({ dialect: 'sqlite', connection: {} })).toMatchObject({ changed: false });
    expect(await setup.applyDatabase({ dialect: 'sqlite', connection: { filename: 'data/bot.db' } })).toMatchObject({ changed: false });
    expect(setKey).not.toHaveBeenCalled();
  });

  it('treats an unchanged secret as unchanged and a new one as a change', async () => {
    const document = { database: { dialect: 'mysql', host: 'db', port: 3306, user: 'bot', password: '${ZHIN_DATABASE_PASSWORD}', database: 'zhin' } };
    const same = setupWith(document, { ZHIN_DATABASE_PASSWORD: 'secret' });
    const connection = { host: 'db', port: 3306, user: 'bot', password: 'secret', database: 'zhin' };
    expect(await same.setup.applyDatabase({ dialect: 'mysql', connection })).toMatchObject({ changed: false });
    expect(same.write).not.toHaveBeenCalled();

    const rotated = setupWith(document, { ZHIN_DATABASE_PASSWORD: 'old' });
    expect(await rotated.setup.applyDatabase({ dialect: 'mysql', connection })).toMatchObject({ changed: true, restartRequired: true });
    expect(rotated.write).toHaveBeenCalledOnce();
    expect(rotated.setKey).toHaveBeenCalledOnce();
  });

  it('still writes, warns and asks for a restart on a real switch', async () => {
    const { setup, setKey } = setupWith({});
    const result = await setup.applyDatabase({ dialect: 'sqlite', connection: { filename: 'data/other.sqlite' } });
    expect(result).toEqual({ changed: true, restartRequired: true, notice: SETUP_NO_MIGRATION_NOTICE });
    expect(setKey).toHaveBeenCalledWith('database', expect.objectContaining({ dialect: 'sqlite', filename: 'data/other.sqlite' }), { environmentWrite: true });
  });

  it('gateway.console.setup.database: no switch and no instance restart when unchanged', async () => {
    const { setup } = setupWith({});
    const switchDatabase = vi.fn(async () => ({ restarting: true }));
    const admin = createLocalConsoleAdmin({ setup, iam: () => undefined, switchDatabase });
    const unchanged = await admin.handle(LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE, { dialect: 'sqlite' });
    expect(unchanged).toEqual({ ok: true, data: { notice: '', switched: false, restarting: false, changed: false } });
    expect(switchDatabase).not.toHaveBeenCalled();

    const changed = await admin.handle(LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE, { dialect: 'sqlite', connection: { filename: 'data/x.sqlite' } });
    expect(changed).toMatchObject({ ok: true, data: { switched: true, restarting: true, changed: true } });
    expect(switchDatabase).toHaveBeenCalledOnce();
  });
});
