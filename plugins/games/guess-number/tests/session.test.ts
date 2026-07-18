import { describe, it, expect, beforeEach } from 'vitest';
import { startGame, processGuess } from '../src/game-flow.js';
import { createServices, type SessionService } from '../src/session-service.js';
import { createInMemoryGuessDb } from '../src/memory-db.js';

function mockMessage(userId: string, channelId = 'g1') {
  return {
    $adapter: 'sandbox',
    $endpoint: 'default',
    $channel: { type: 'group', id: channelId },
    $sender: { id: userId, name: userId },
  } as never;
}

describe('guess-number sessions', () => {
  let services: SessionService;

  beforeEach(() => {
    services = createServices(createInMemoryGuessDb());
  });

  it('allows two users in same channel to start separate games', async () => {
    const startA = await startGame(services, mockMessage('alice'));
    const startB = await startGame(services, mockMessage('bob'));

    expect(startA).toContain('猜数字');
    expect(startB).toContain('猜数字');
    expect(startB).not.toContain('本频道');

    const ch = 'sandbox-default-group:g1';
    expect(await services.getActiveForUser(ch, 'alice')).toBeTruthy();
    expect(await services.getActiveForUser(ch, 'bob')).toBeTruthy();
  });

  it('processGuess works for own session', async () => {
    await startGame(services, mockMessage('alice'));
    const reply = await processGuess(services, mockMessage('alice'), 50);
    expect(reply).toMatch(/大|小|机会/);
  });
});
