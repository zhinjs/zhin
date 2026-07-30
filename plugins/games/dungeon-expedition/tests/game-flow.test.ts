import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInMemoryGameDb,
  gameSessionCoordinator,
  plainTextFromSendContent,
  type GameMessageLike,
} from '@zhin.js/game-kit';
import {
  handleDungeonChoice,
  startDungeon,
} from '../src/game-flow.js';
import {
  SessionService,
  type DungeonDatabase,
} from '../src/session-service.js';
import { dungeonSessionToken } from '../src/view.js';

const message: GameMessageLike = {
  $adapter: 'sandbox',
  $endpoint: 'default',
  $channel: { type: 'group', id: 'room' },
  $sender: { id: 'alice', name: 'Alice' },
};

describe('dungeon game flow', () => {
  beforeEach(() => {
    gameSessionCoordinator.clear();
  });

  it('returns a structured lobby with native controls', async () => {
    const service = createService();
    const reply = await startDungeon(service, message);

    expect(plainTextFromSendContent(reply)).toContain('等待队员');
    expect(Array.isArray(reply) && reply.some((item) =>
      typeof item === 'object' && item !== null && item.type === 'keyboard'))
      .toBe(true);
  });

  it('refreshes instead of applying an action from a stale view', async () => {
    const service = createService();
    await startDungeon(service, message);
    const session = await service.getActiveByChannel(
      'sandbox-default-group:room',
    );
    if (!session) throw new Error('missing session');
    const staleToken = dungeonSessionToken(session);
    await handleDungeonChoice(service, message, staleToken, 'start');
    const reply = await handleDungeonChoice(
      service,
      message,
      staleToken,
      'explore',
    );

    expect(plainTextFromSendContent(reply)).toContain('旧回合');
    expect((await service.getById(session.id))?.revision).toBe(1);
  });
});

function createService(): SessionService {
  return new SessionService(
    createInMemoryGameDb(['dungeon_sessions']) as unknown as DungeonDatabase,
  );
}
