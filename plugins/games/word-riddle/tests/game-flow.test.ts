import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey, smokeGameMessage } from '@zhin.js/game-kit';
import { processAnswerText, startGame } from '../src/game-flow.js';
import { getRiddleById } from '../src/engine.js';
import { mountRiddleMemoryServices } from '../src/memory-db.js';
import { currentRiddleId, type SessionService } from '../src/session-service.js';

describe('word-riddle game-flow (plugin=null)', () => {
  let services: SessionService;

  beforeEach(() => {
    services = mountRiddleMemoryServices();
  });

  it('processAnswerText returns text when guessing wrong with null plugin', async () => {
    const message = smokeGameMessage();
    await startGame(services, message as never, 'char');

    const reply = await processAnswerText(services, message as never, '错误答案');

    expect(reply).toBeTruthy();
    expect(typeof reply).toBe('string');
    expect(reply).toMatch(/不对|猜谜|不算失误/);
  });

  it('格式不合规（字数不符）只提示不扣失误', async () => {
    const message = smokeGameMessage();
    await startGame(services, message as never, 'char');
    const ch = channelKey(message as never);
    const before = (await services.getActiveForUser(ch, message.$sender.id))!;

    const reply = await processAnswerText(services, message as never, '好的');

    expect(reply).toMatch(/不算失误/);
    const after = (await services.getById(before.id))!;
    expect(after.wrong_count).toBe(0);
    expect(after.status).toBe('active');
  });

  it('格式合规但答错仍计一次失误', async () => {
    const message = smokeGameMessage();
    await startGame(services, message as never, 'char');
    const ch = channelKey(message as never);
    const before = (await services.getActiveForUser(ch, message.$sender.id))!;
    const entry = getRiddleById(currentRiddleId(before)!)!;
    const wrongChar = entry.answer === '龘' ? '错' : '龘';

    const reply = await processAnswerText(services, message as never, wrongChar);

    expect(reply).toMatch(/不对/);
    const after = (await services.getById(before.id))!;
    expect(after.wrong_count).toBe(1);
  });
});
