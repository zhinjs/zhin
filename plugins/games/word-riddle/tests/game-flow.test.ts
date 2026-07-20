import { beforeEach, describe, expect, it } from 'vitest';
import { smokeGameMessage } from '@zhin.js/game-kit';
import { processAnswerText, startGame } from '../src/game-flow.js';
import { mountRiddleMemoryServices } from '../src/memory-db.js';
import type { SessionService } from '../src/session-service.js';

describe('word-riddle game-flow (plugin=null)', () => {
  let services: SessionService;

  beforeEach(() => {
    services = mountRiddleMemoryServices();
  });

  it('processAnswerText returns text when guessing wrong with null plugin', async () => {
    const message = smokeGameMessage();
    await startGame(null, services, message as never, 'char');

    const reply = await processAnswerText(null, services, message as never, '错误答案');

    expect(reply).toBeTruthy();
    expect(typeof reply).toBe('string');
    expect(reply).toMatch(/不对|猜谜/);
  });
});
