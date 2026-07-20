import { beforeEach, describe, expect, it } from 'vitest';
import { smokeGameMessage } from '@zhin.js/game-kit';
import { processIdiomText, startGame } from '../src/game-flow.js';
import { mountChainMemoryServices } from '../src/memory-db.js';
import type { SessionService } from '../src/session-service.js';

describe('idiom-chain game-flow (plugin=null)', () => {
  let services: SessionService;

  beforeEach(() => {
    services = mountChainMemoryServices();
  });

  it('processIdiomText returns text when guessing wrong with null plugin', async () => {
    const message = smokeGameMessage();
    await startGame(null, services, message as never);

    const reply = await processIdiomText(null, services, message as never, '不是成语');

    expect(reply).toBeTruthy();
    expect(typeof reply).toBe('string');
    expect(reply).toMatch(/四字成语|词库/);
  });
});
