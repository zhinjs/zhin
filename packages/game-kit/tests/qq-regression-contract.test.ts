import { describe, expect, it } from 'vitest';
import { buildChoiceKeyboard } from '../src/choice-keyboard.js';

/** Phase 0 契约（自动化）；实机项见 examples/qq-games-bot/QQ-REGRESSION.md */
describe('QQ regression contracts', () => {
  it('hub menu profile uses callback in group (multi-user lobby)', () => {
    const content = buildChoiceKeyboard({
      gamePrefix: 'hub',
      sessionId: 'scope1',
      narrative: '大厅',
      choices: [{ id: 'g_ttt', label: '井字棋' }],
      interactionProfile: 'menu',
      channelType: 'group',
    });
    const kb = content[1] as { data: { rows: Array<Array<{ mode?: string }>> } };
    expect(kb.data.rows[0]?.[0]?.mode).toBe('callback');
  });
});
