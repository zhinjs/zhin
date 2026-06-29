import { describe, expect, it } from 'vitest';
import { buildBotHelpHtml, buildHubHelpHtml } from '../src/help-card.js';
import { buildBotHelpReply } from '../src/game-hub-menu.js';
import type { RegisteredGame } from '../src/game-hub-feature.js';
import type { CommandHelpSource } from '../src/command-help.js';

const mockGame: RegisteredGame = {
  id: 'ttt',
  title: '井字棋',
  icon: '♟️',
  description: '三子连珠',
  commandPrefix: '/井字棋',
  quickStart: '人机',
  menus: [],
  runAction: async () => undefined,
};

function cmd(pattern: string, desc: string[]): CommandHelpSource {
  return { pattern, helpInfo: { desc } };
}

describe('help-card', () => {
  it('buildBotHelpHtml includes games and filtered commands', () => {
    const html = buildBotHelpHtml({
      games: [mockGame],
      commands: [
        cmd('/游戏', ['游戏大厅']),
        cmd('stats', ['消息统计', '今日统计']),
      ],
      channelType: 'group',
    });
    expect(html).toContain('井字棋');
    expect(html).toContain('/井字棋');
    expect(html).toContain('stats');
    expect(html).toContain('QQ 群用法');
  });

  it('buildBotHelpHtml shows full command patterns', () => {
    const html = buildBotHelpHtml({
      games: [],
      commands: [cmd('stats-week', ['周消息统计', '查看本周消息统计'])],
    });
    expect(html).toContain('stats-week');
    expect(html).not.toContain('…');
  });

  it('buildHubHelpHtml is lobby-focused', () => {
    const html = buildHubHelpHtml([mockGame], [cmd('/游戏', ['游戏大厅'])]);
    expect(html).toContain('游戏大厅帮助');
    expect(html).toContain('井字棋');
    expect(html).not.toContain('其他命令');
  });

  it('buildBotHelpReply returns html segment with text fallback', () => {
    const reply = buildBotHelpReply([mockGame], { channelType: 'group' });
    const items = Array.isArray(reply) ? reply : [reply];
    const htmlSeg = items.find((s) => typeof s === 'object' && (s as { type?: string }).type === 'html');
    expect(htmlSeg).toBeTruthy();
    expect((htmlSeg as { data: { text?: string; fileName?: string } }).data.fileName).toBe('bot-help.png');
    expect((htmlSeg as { data: { text?: string } }).data.text).toContain('井字棋');
  });
});
