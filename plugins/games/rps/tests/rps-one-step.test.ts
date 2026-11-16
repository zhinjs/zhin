/** #1250 near-miss-suggestion-param-misleading: 「玩石头剪刀布 石头」 starts a game and plays the move. */
import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey, createMemoryGameServices, plainTextFromSendContent, type GamePlayer } from '@zhin.js/game-kit';
import { runRpsCommand } from '../src/rps-command.js';
import { createServices, type SessionService } from '../src/session-service.js';

const conversation = { endpoint: { adapter: 'test', id: 'default' }, kind: 'group' as const, id: 'g1' };
const player = { target: conversation, sender: { id: 'u1', name: 'u1' }, locale: 'zh-CN' } as unknown as GamePlayer;
let services: SessionService;

describe('rps one-step move', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['rps_sessions'], createServices);
  });

  it('starts a game and plays the move when there is none', async () => {
    const reply = await runRpsCommand(services, player, '石头');
    const text = plainTextFromSendContent(reply);
    expect(text).not.toContain('未知子命令');
    expect(text).toContain("你出 ✊ 石头");
    const row = await services.getLatestForUser(channelKey(player), 'u1');
    expect(row).not.toBeNull();
  });

  it('still reports an unknown word as an unknown subcommand', async () => {
    expect(plainTextFromSendContent(await runRpsCommand(services, player, '香蕉'))).toContain('未知子命令：香蕉');
  });
});
