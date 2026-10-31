import { createInMemoryGameDb, type InMemoryGameModel } from '../src/memory-db.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

it('commits an in-memory transaction before publishing its rows and preserves a concurrent other-scope write', async () => {
  const db = createInMemoryGameDb(['sessions', 'moves']), sessions = db.models.get('sessions')!;
  await sessions.create({ id: 'a', count: 0 }); await sessions.create({ id: 'b', count: 0 });
  const entered = deferred(), finish = deferred();
  const transaction = db.transaction(async tx => {
    await tx.models.get('sessions')!.updateWhere({ id: 'a' }, { count: 1 });
    entered.resolve(); await finish.promise;
  });
  await entered.promise;
  let visible = false, updated = false;
  const reading = sessions.findOne({ id: 'a' }).then(row => { visible = true; return row; });
  const other = sessions.updateWhere({ id: 'b' }, { count: 1 }).then(() => { updated = true; });
  await Promise.resolve(); expect(visible).toBe(false); expect(updated).toBe(false);
  finish.resolve(); await transaction; await other;
  expect(await reading).toEqual({ id: 'a', count: 1 });
  expect(await sessions.findAll()).toEqual([{ id: 'a', count: 1 }, { id: 'b', count: 1 }]);
});

it('discards all candidate rows on rollback and invalidates escaped callback models', async () => {
  const db = createInMemoryGameDb(['sessions', 'moves']); await db.models.get('sessions')!.create({ id: 'a', count: 0 });
  let escaped!: InMemoryGameModel;
  await expect(db.transaction(async tx => {
    escaped = tx.models.get('sessions')!;
    await escaped.updateWhere({ id: 'a' }, { count: 1 });
    await tx.models.get('moves')!.create({ id: 'move' });
    throw new Error('synthetic rollback');
  })).rejects.toThrow('rollback');
  expect(await db.models.get('sessions')!.findAll()).toEqual([{ id: 'a', count: 0 }]);
  expect(await db.models.get('moves')!.findAll()).toHaveLength(0);
  await expect(async () => escaped.updateWhere({ id: 'a' }, { count: 2 })).rejects.toThrow('transaction has ended');
});
