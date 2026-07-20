import { describe, expect, it } from 'vitest';
import { buildChoiceKeyboard } from '../src/choice-keyboard.js';
import { formatBotHelp, HUB_PREFIX } from '../src/game-hub-menu.js';

/** Phase 0 契约（自动化）；实机项见 examples/qq-games-bot/QQ-REGRESSION.md */
describe('QQ regression contracts', () => {
  it('hub menu profile uses callback in group (multi-user lobby)', () => {
    const content = buildChoiceKeyboard({
      gamePrefix: HUB_PREFIX,
      sessionId: 'scope1',
      narrative: '大厅',
      choices: [{ id: 'g_ttt', label: '井字棋' }],
      interactionProfile: 'menu',
      channelType: 'group',
    });
    const kb = content[1] as { data: { rows: Array<Array<{ mode?: string }>> } };
    expect(kb.data.rows[0]?.[0]?.mode).toBe('callback');
  });

  it('formatBotHelp mentions QQ group hint and auto command catalog', () => {
    const text = formatBotHelp([], {
      channelType: 'group',
      commands: [
        { pattern: '/战绩', helpInfo: { desc: ['战绩', '查看游戏战绩'] } },
        { pattern: 'checkin', helpInfo: { desc: ['签到', '每日签到'] } },
      ],
    });
    expect(text).toContain('@ 机器人');
    expect(text).toContain('/战绩');
    expect(text).toContain('checkin');
  });
});
