import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey, smokeGameMessage } from '@zhin.js/game-kit';
import { handleChoice, processIdiomText, startGame } from '../src/game-flow.js';
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

  it('格式不合规（非四字）只提示不扣失误', async () => {
    const message = smokeGameMessage();
    await startGame(null, services, message as never);
    const ch = channelKey(message as never);
    const before = (await services.getActiveForUser(ch, message.$sender.id))!;

    const reply = await processIdiomText(null, services, message as never, '好的');

    expect(reply).toMatch(/不算失误/);
    const after = (await services.getById(before.id))!;
    expect(after.wrong_count).toBe(0);
    expect(after.status).toBe('active');
  });

  it('四字但非词库成语仍计一次失误', async () => {
    const message = smokeGameMessage();
    await startGame(null, services, message as never);
    const ch = channelKey(message as never);
    const before = (await services.getActiveForUser(ch, message.$sender.id))!;

    await processIdiomText(null, services, message as never, '不是成语');

    const after = (await services.getById(before.id))!;
    expect(after.wrong_count).toBe(1);
  });

  it('hint 无可用词时单次发送终局视图（先更新状态）', async () => {
    const message = smokeGameMessage();
    await startGame(null, services, message as never);
    const ch = channelKey(message as never);
    const before = (await services.getActiveForUser(ch, message.$sender.id))!;
    const prevScore = before.player_score;
    // last_idiom 不在词库中 → pickHintIdiom 必为 null
    await services.updateSession(before.id, { last_idiom: '龘龘龘龘' });

    const reply = await handleChoice(null, services, message as never, before.id, 'hint');

    expect(reply).toBeTruthy();
    expect(String(reply)).toMatch(/你赢了/);
    const after = (await services.getById(before.id))!;
    expect(after.status).toBe('won');
    expect(after.player_score).toBe(prevScore + 1);
  });
});
