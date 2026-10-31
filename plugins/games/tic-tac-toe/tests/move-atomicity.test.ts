import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabaseHost } from '../../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { PluginDatabaseHost, rootPluginId, qualifyPluginResourceName } from 'zhin.js/plugin-runtime';
import { createHostGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from '../src/models.js';
import { createServices } from '../src/session-service.js';
import { handleMove } from '../src/game-flow.js';

const target = { endpoint: { adapter: 'synthetic', id: 'canonical' }, kind: 'group' as const, id: 'room' };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-atomic-ttt-')), filename = join(directory, 'state.sqlite');
  const root = rootPluginId(), host = createDatabaseHost({ dialect: 'sqlite', filename }), database = new PluginDatabaseHost(root, host);
  defineHostTables(database);
  const services = createServices(createHostGameDb(database, ['ttt_sessions', 'ttt_moves', 'ttt_queue', 'ttt_spectators']));
  await host.start();
  const sqlite = new DatabaseSync(filename);
  const session = await services.session.createSession({ message: { target, sender: { id: 'alice' } },
    playerX: 'alice', playerO: 'bob', boardJson: JSON.stringify(Array(9).fill(0)) });
  const changed = vi.fn(); services.session.events.on('turn:change', changed);
  return { database, services, session, sqlite, changed,
    table: qualifyPluginResourceName(root, 'ttt_moves').replaceAll('"', '""'),
    async close() { sqlite.close(); await host.stop(); await rm(directory, { recursive: true, force: true }); } };
}

it('rolls back an actual SQLite move append failure before publishing state or events, then accepts an explicit retry', async () => {
  const f = await fixture();
  try {
    f.sqlite.exec(`CREATE TRIGGER reject_move BEFORE INSERT ON "${f.table}" BEGIN SELECT RAISE(ABORT, 'synthetic move append failure'); END`);
    await expect(handleMove(f.services, { target, sender: { id: 'alice' } }, f.session.id, 0)).rejects.toThrow('synthetic move append failure');
    expect(await f.services.session.getById(f.session.id)).toEqual(f.session);
    expect(await f.database.models.get('ttt_moves')!.select()).toHaveLength(0); expect(f.changed).not.toHaveBeenCalled();
    f.sqlite.exec('DROP TRIGGER reject_move');
    await handleMove(f.services, { target, sender: { id: 'alice' } }, f.session.id, 0);
    expect(await f.services.session.getById(f.session.id)).toMatchObject({ revision: 1, move_count: 1, turn: 2 });
    expect(await f.database.models.get('ttt_moves')!.select()).toHaveLength(1); expect(f.changed).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('does not retry or publish events when the atomic commit response is lost, and persisted action identity prevents duplication', async () => {
  const f = await fixture();
  try {
    const transaction = f.database.transaction.bind(f.database);
    const spy = vi.spyOn(f.database, 'transaction').mockImplementationOnce(async callback => {
      await transaction(callback); throw new Error('synthetic commit response lost');
    });
    await expect(handleMove(f.services, { target, sender: { id: 'alice' } }, f.session.id, 0)).rejects.toThrow('commit response lost');
    expect(spy).toHaveBeenCalledOnce(); spy.mockRestore();
    expect(f.changed).not.toHaveBeenCalled();
    expect(await f.services.session.getById(f.session.id)).toMatchObject({ revision: 1, move_count: 1 });
    expect(await f.database.models.get('ttt_moves')!.select()).toHaveLength(1);
    const repeated = await f.services.session.performMove({ sessionId: f.session.id, playerId: 'alice', cell: 0, expectedRevision: 0,
      boardJson: JSON.stringify([1, 0, 0, 0, 0, 0, 0, 0, 0]), moveCount: 1, nextTurn: 2, status: 'active', winner: 0 });
    expect(repeated.kind).toBe('duplicate');
    expect(await f.database.models.get('ttt_moves')!.select()).toHaveLength(1); expect(f.changed).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
