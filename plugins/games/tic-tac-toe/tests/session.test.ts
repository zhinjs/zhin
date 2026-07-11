import { describe, it, expect, beforeEach } from 'vitest';
import { QueueService, SessionService, type TttDatabase } from '../src/session-service.js';

import { emptyBoard } from '../src/engine.js';

type Row = Record<string, unknown>;

function createMockDb(): TttDatabase {
  const tables = new Map<string, Row[]>();

  function model(name: string) {
    if (!tables.has(name)) tables.set(name, []);
    const rows = () => tables.get(name)!;

    const match = (row: Row, q: Record<string, unknown>) =>
      Object.entries(q).every(([k, v]) => row[k] === v);

    return {
      findAll: async (q: Record<string, unknown> = {}) =>
        rows().filter((row) => match(row, q)),
      findOne: async (q: Record<string, unknown> = {}) => {
        const found = rows().find((row) => match(row, q));
        return found ?? null;
      },
      create: async (row: Row) => {
        rows().push({ ...row });
        return row;
      },
      updateWhere: async (where: Record<string, unknown>, patch: Row) => {
        for (const row of rows()) {
          if (match(row, where)) {
            Object.assign(row, patch);
          }
        }
        return 1;
      },
      deleteWhere: async (where: Record<string, unknown>) => {
        const kept = rows().filter((row) => !match(row, where));
        tables.set(name, kept);
        return kept.length;
      },
    };
  }

  return {
    models: {
      get: (name: string) => model(name),
    },
  } as unknown as TttDatabase;
}

function mockMessage(channelId = 'c1', userId = 'u1') {
  return {
    $adapter: 'sandbox',
    $endpoint: 'default',
    $channel: { type: 'group', id: channelId },
    $sender: { id: userId },
  } as any;
}

describe('QueueService', () => {
  let queue: QueueService;

  beforeEach(() => {
    queue = new QueueService(createMockDb());
  });

  it('matches two players and clears queue', async () => {
    await queue.join('ch1', 'alice');
    await queue.join('ch1', 'bob');
    const pair = await queue.tryMatch('ch1');
    expect(pair).toEqual([
      { id: 'alice', displayName: 'alice' },
      { id: 'bob', displayName: 'bob' },
    ]);
    expect(await queue.count('ch1')).toBe(0);
  });

  it('returns position for duplicate join', async () => {
    await queue.join('ch1', 'alice');
    const { position } = await queue.join('ch1', 'alice');
    expect(position).toBe(1);
  });
});

describe('SessionService', () => {
  let session: SessionService;

  beforeEach(() => {
    session = new SessionService(createMockDb());
  });

  it('creates and fetches active session for player', async () => {
    const msg = mockMessage();
    const row = await session.createSession({
      message: msg,
      playerX: 'alice',
      playerO: 'bob',
      boardJson: JSON.stringify(emptyBoard()),
    });
    const active = await session.getActiveForUser('sandbox-default-group:c1', 'alice');
    expect(active?.id).toBe(row.id);
    expect(active?.player_x).toBe('alice');
  });

  it('aborts stale sessions', async () => {
    const db = createMockDb();
    const sessionSvc = new SessionService(db);
    const msg = mockMessage();
    const row = await sessionSvc.createSession({
      message: msg,
      playerX: 'a',
      playerO: 'b',
      boardJson: JSON.stringify(emptyBoard()),
    });
    const model = db.models.get('ttt_sessions') as {
      findAll: (q: Record<string, unknown>) => Promise<Row[]>;
    };
    const rows = await model.findAll({ id: row.id });
    (rows[0] as Row).updated_at = Date.now() - 60_000;
    const n = await sessionSvc.abortStale(30_000);
    expect(n).toBe(1);
    const after = await sessionSvc.getById(row.id);
    expect(after?.status).toBe('aborted');
  });
});
