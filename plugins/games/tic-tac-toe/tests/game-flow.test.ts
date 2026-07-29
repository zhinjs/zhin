import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOT_ID,
  restartFromTerminal,
  startBotGame,
  startPvpGame,
} from '../src/game-flow.js';
import { mountTttMemoryServices } from '../src/memory-db.js';
import type { SessionServices } from '../src/session-service.js';

let services: SessionServices;

function makeMessage(senderId = 'u1') {
  return {
    $adapter: 'test',
    $endpoint: 'default',
    $channel: { type: 'group', id: 'g1' },
    $sender: { id: senderId, name: senderId },
    content: '',
    $reply: async () => 'mid-1',
  } as never;
}

const CH = 'test-default-group:g1';

describe('tic-tac-toe game-flow', () => {
  beforeEach(() => {
    services = mountTttMemoryServices();
  });

  it('startPvpGame 有频道占用守卫', async () => {
    const message = makeMessage('u1');
    await startBotGame(services, message);
    const reply = await startPvpGame(
      services,
      message,
      { id: 'u1', displayName: 'u1' },
      { id: 'u2', displayName: 'u2' },
    );
    expect(reply).toBe('当前频道已有进行中的对局。');
    const active = await services.session.getActiveByChannel(CH);
    // 仍是原本人机局，未新开 PvP
    expect(active?.player_o).toBe(BOT_ID);
  });

  it('restartFromTerminal 拒绝进行中的对局', async () => {
    const message = makeMessage('u1');
    await startBotGame(services, message);
    const active = (await services.session.getActiveByChannel(CH))!;
    const reply = await restartFromTerminal(services, message, active.id);
    expect(reply).toBe('对局尚未结束，无法重开。');
  });

  it('PvP 终局 restart 重开 PvP（不降级为人机）', async () => {
    const message = makeMessage('u1');
    await startPvpGame(
      services,
      message,
      { id: 'u1', displayName: 'u1' },
      { id: 'u2', displayName: 'u2' },
    );
    const old = (await services.session.getActiveByChannel(CH))!;
    await services.session.updateSession(old.id, { status: 'won', winner: 1 });

    const reply = await restartFromTerminal(services, message, old.id);
    expect(reply).not.toBe('对局尚未结束，无法重开。');

    const oldAfter = (await services.session.getById(old.id))!;
    expect(oldAfter.status).toBe('aborted');

    const active = (await services.session.getActiveByChannel(CH))!;
    expect(active.id).not.toBe(old.id);
    expect(active.player_x).toBe('u1');
    expect(active.player_o).toBe('u2');
  });

  it('人机终局 restart 仍重开人机', async () => {
    const message = makeMessage('u1');
    await startBotGame(services, message);
    const old = (await services.session.getActiveByChannel(CH))!;
    await services.session.updateSession(old.id, { status: 'draw', winner: 0 });

    await restartFromTerminal(services, message, old.id);

    const active = (await services.session.getActiveByChannel(CH))!;
    expect(active.id).not.toBe(old.id);
    expect(active.player_o).toBe(BOT_ID);
  });
});
