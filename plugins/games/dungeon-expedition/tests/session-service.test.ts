import { beforeEach, describe, expect, it } from 'vitest';
import {
  SessionRevisionConflictError,
  createInMemoryGameDb,
  gameSessionCoordinator,
  type GameMessageLike,
} from '@zhin.js/game-kit';
import {
  SessionService,
  stateFromSession,
  type DungeonDatabase,
} from '../src/session-service.js';

const message: GameMessageLike = {
  $adapter: 'sandbox',
  $endpoint: 'default',
  $channel: { type: 'group', id: 'room' },
  $sender: { id: 'alice', name: 'Alice' },
};

describe('dungeon SessionService', () => {
  beforeEach(() => {
    gameSessionCoordinator.clear();
  });

  it('deduplicates concurrent adapter retries', async () => {
    const service = createService();
    const session = await service.createSession(message, 'retry-seed');
    const action = {
      sessionId: session.id,
      actorId: 'alice',
      actorName: 'Alice',
      action: { type: 'start' } as const,
      actionId: 'adapter-message-1',
      expectedRevision: 0,
    };

    const results = await Promise.all([
      service.performAction(action),
      service.performAction(action),
      service.performAction(action),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      'applied',
      'duplicate',
      'duplicate',
    ]);
    expect(await service.getById(session.id)).toMatchObject({ revision: 1 });
  });

  it('allows only one of two distinct actions from the same revision', async () => {
    const service = createService();
    const session = await service.createSession(message, 'race-seed');
    await service.performAction({
      sessionId: session.id,
      actorId: 'alice',
      actorName: 'Alice',
      action: { type: 'start' },
      actionId: 'start',
      expectedRevision: 0,
    });

    const attempts = await Promise.allSettled([
      service.performAction({
        sessionId: session.id,
        actorId: 'alice',
        actorName: 'Alice',
        action: { type: 'explore' },
        actionId: 'explore-a',
        expectedRevision: 1,
      }),
      service.performAction({
        sessionId: session.id,
        actorId: 'alice',
        actorName: 'Alice',
        action: { type: 'explore' },
        actionId: 'explore-b',
        expectedRevision: 1,
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.any(SessionRevisionConflictError),
    });
    expect(await service.getById(session.id)).toMatchObject({ revision: 2 });
  });

  it('continues from persisted state through a fresh service instance', async () => {
    const database = createInMemoryGameDb(['dungeon_sessions']);
    const first = new SessionService(database as unknown as DungeonDatabase);
    const session = await first.createSession(message, 'restart-seed');
    await first.performAction({
      sessionId: session.id,
      actorId: 'alice',
      actorName: 'Alice',
      action: { type: 'start' },
      actionId: 'start',
    });
    const beforeRestart = await first.getById(session.id);

    const restored = new SessionService(database as unknown as DungeonDatabase);
    const result = await restored.performAction({
      sessionId: session.id,
      actorId: 'alice',
      actorName: 'Alice',
      action: { type: 'explore' },
      actionId: 'explore-after-restart',
      expectedRevision: beforeRestart?.revision,
    });

    expect(result.session.revision).toBe(2);
    expect(result.session.rng_state).not.toBe(beforeRestart?.rng_state);
    expect(stateFromSession(result.session).phase)
      .toMatch(/exploring|combat/);
  });
});

function createService(): SessionService {
  return new SessionService(
    createInMemoryGameDb(['dungeon_sessions']) as unknown as DungeonDatabase,
  );
}
