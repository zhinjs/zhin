import { describe, expect, it } from 'vitest';
import {
  SessionRevisionConflictError,
  VersionedSessionService,
  createInMemoryGameDb,
  type GameSessionDatabase,
  type VersionedGameSessionRow,
} from '../src/index.js';

interface TestRow extends VersionedGameSessionRow {
  player_id: string;
  score: number;
}

class TestVersionedService extends VersionedSessionService<TestRow> {
  constructor() {
    const database = createInMemoryGameDb(['versioned_sessions']);
    super(database as unknown as GameSessionDatabase<TestRow>, {
      gameId: 'versioned',
      table: 'versioned_sessions',
      userFields: ['player_id'],
    });
  }

  start(): Promise<TestRow> {
    const now = Date.now();
    return this.createRow({
      id: 'session-1',
      channel_key: 'sandbox-default-group:room',
      player_id: 'alice',
      score: 0,
      status: 'active',
      revision: 0,
      processed_actions: '[]',
      updated_at: now,
      created_at: now,
    });
  }
}

describe('VersionedSessionService', () => {
  it('serializes concurrent actions without losing updates', async () => {
    const service = new TestVersionedService();
    await service.start();

    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      service.mutateSession('session-1', {
        actionId: `action-${index}`,
        apply: async (session) => {
          await Promise.resolve();
          return { score: session.score + 1 };
        },
      })));

    expect(await service.getById('session-1')).toMatchObject({
      score: 20,
      revision: 20,
    });
  });

  it('applies a repeated action id only once', async () => {
    const service = new TestVersionedService();
    await service.start();

    const first = await service.mutateSession('session-1', {
      actionId: 'same-action',
      apply: (session) => ({ score: session.score + 1 }),
    });
    const duplicate = await service.mutateSession('session-1', {
      actionId: 'same-action',
      apply: (session) => ({ score: session.score + 100 }),
    });

    expect(first.kind).toBe('applied');
    expect(duplicate.kind).toBe('duplicate');
    expect(duplicate.session.score).toBe(1);
  });

  it('rejects an action created for an older revision', async () => {
    const service = new TestVersionedService();
    await service.start();
    await service.mutateSession('session-1', {
      actionId: 'first',
      expectedRevision: 0,
      apply: { score: 1 },
    });

    await expect(service.mutateSession('session-1', {
      actionId: 'stale',
      expectedRevision: 0,
      apply: { score: 2 },
    })).rejects.toBeInstanceOf(SessionRevisionConflictError);
  });
});
