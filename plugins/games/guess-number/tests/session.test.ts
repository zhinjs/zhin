import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryGameServices,
  plainTextFromSendContent,
} from '@zhin.js/game-kit';
import {
  handleGuessChoice,
  processGuess,
  startGame,
} from '../src/game-flow.js';
import { createServices, type SessionService } from '../src/session-service.js';

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
    services = createMemoryGameServices(['guess_sessions'], createServices);
  });

  it('allows two users in same channel to start separate games', async () => {
    const startA = await startGame(services, mockMessage('alice'));
    const startB = await startGame(services, mockMessage('bob'));

    expect(plainTextFromSendContent(startA)).toContain('猜数字');
    expect(plainTextFromSendContent(startB)).toContain('猜数字');
    expect(plainTextFromSendContent(startB)).not.toContain('本频道');

    const ch = 'sandbox-default-group:g1';
    expect(await services.getActiveForUser(ch, 'alice')).toBeTruthy();
    expect(await services.getActiveForUser(ch, 'bob')).toBeTruthy();
  });

  it('processGuess works for own session', async () => {
    await startGame(services, mockMessage('alice'));
    const session = await services.getActiveForUser('sandbox-default-group:g1', 'alice');
    expect(session).toBeTruthy();
    const wrongGuess = session!.secret === 1 ? 100 : 1;
    const reply = await processGuess(services, mockMessage('alice'), wrongGuess);
    expect(plainTextFromSendContent(reply!)).toMatch(/大|小|机会/);
  });

  it('supports terminal restart through the structured action path', async () => {
    const message = mockMessage('alice');
    await startGame(services, message);
    const session = (await services.getActiveForUser(
      'sandbox-default-group:g1',
      'alice',
    ))!;

    const quitReply = await handleGuessChoice(
      services,
      message,
      session.id,
      'quit',
    );
    expect(plainTextFromSendContent(quitReply)).toContain('放弃');
    expect(await services.getById(session.id)).toMatchObject({
      status: 'aborted',
    });

    const restartReply = await handleGuessChoice(
      services,
      message,
      session.id,
      'restart',
    );
    expect(plainTextFromSendContent(restartReply)).toContain('猜数字');
    expect(await services.getActiveForUser(
      'sandbox-default-group:g1',
      'alice',
    )).toBeTruthy();
  });
});
