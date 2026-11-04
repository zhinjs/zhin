import { createInMemoryGameDb, SessionRevisionConflictError } from '@zhin.js/game-kit';
import { createServices } from '../src/session-service.js';
import { handleMove } from '../src/game-flow.js';

const target = { endpoint: { adapter: 'synthetic', id: 'canonical' }, kind: 'group' as const, id: 'room' };
async function fixture() {
  const db = createInMemoryGameDb(['ttt_sessions', 'ttt_queue', 'ttt_moves', 'ttt_spectators']);
  const services = createServices(db as never);
  const session = await services.session.createSession({
    message: { target, sender: { id: 'alice' } },
    playerX: 'alice',
    playerO: 'bob',
    boardJson: JSON.stringify(Array(9).fill(0)),
  });
  return { db, services, session };
}
function overlapFirstReads(...instances: Awaited<ReturnType<typeof fixture>>['services'][]) {
  let reads = 0, release!: () => void;
  const both = new Promise<void>(done => { release = done; });
  for (const services of instances) {
    const get = services.session.getById.bind(services.session);
    vi.spyOn(services.session, 'getById').mockImplementation(async id => {
      const row = await get(id);
      if (reads < 2) { reads += 1; if (reads === 2) release(); await both; }
      return row;
    });
  }
}

it('allows only one of two competing real flow moves at the same revision, without an orphan move', async () => {
  const f = await fixture();
  overlapFirstReads(f.services);
  const results = await Promise.allSettled(
    [0, 1].map((cell) => handleMove(f.services, { target, sender: { id: 'alice' } }, f.session.id, cell)),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: expect.any(SessionRevisionConflictError),
  });
  expect(await f.services.session.getById(f.session.id)).toMatchObject({ revision: 1, move_count: 1, turn: 2 });
  expect(await f.db.models.get('ttt_moves')!.findAll()).toHaveLength(1);
});

it('deduplicates the same real flow action at the same revision and records it once', async () => {
  const f = await fixture();
  overlapFirstReads(f.services);
  await Promise.all(
    [0, 0].map((cell) => handleMove(f.services, { target, sender: { id: 'alice' } }, f.session.id, cell)),
  );
  expect(await f.services.session.getById(f.session.id)).toMatchObject({ revision: 1, move_count: 1 });
  expect(await f.db.models.get('ttt_moves')!.findAll()).toHaveLength(1);
});

it('refuses a stale CAS from another service instance without inserting an orphan move', async () => {
  const f = await fixture(), second = createServices(f.db);
  overlapFirstReads(f.services, second);
  const results = await Promise.allSettled([f.services, second].map((services, cell) =>
    handleMove(services, { target, sender: { id: 'alice' } }, f.session.id, cell)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.any(SessionRevisionConflictError) });
  expect(await f.services.session.getById(f.session.id)).toMatchObject({ revision: 1, move_count: 1 });
  expect(await f.db.models.get('ttt_moves')!.findAll()).toHaveLength(1);
});
