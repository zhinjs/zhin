import { describe, expect, it } from 'vitest';
import { segment } from 'zhin.js';
import { buildChoiceKeyboard } from '../src/choice-keyboard.js';
import { HUB_PREFIX } from '../src/game-hub-menu.js';

describe('buildChoiceKeyboard interactionProfile', () => {
  it('menu profile sets command mode on buttons', () => {
    const content = buildChoiceKeyboard({
      gamePrefix: HUB_PREFIX,
      sessionId: 'scope1',
      narrative: '大厅',
      choices: [{ id: 'g_ttt', label: '井字棋' }],
      interactionProfile: 'menu',
      channelType: 'private',
    });
    const kb = content[1] as { type: string; data: { rows: Array<Array<{ mode?: string }>> } };
    expect(kb.type).toBe('keyboard');
    expect(kb.data.rows[0]?.[0]?.mode).toBe('command');
  });

  it('menu profile uses callback in group channels', () => {
    const content = buildChoiceKeyboard({
      gamePrefix: HUB_PREFIX,
      sessionId: 'scope1',
      narrative: '大厅',
      choices: [{ id: 'g_ttt', label: '井字棋' }],
      interactionProfile: 'menu',
      channelType: 'group',
    });
    const kb = content[1] as { type: string; data: { rows: Array<Array<{ mode?: string }>> } };
    expect(kb.data.rows[0]?.[0]?.mode).toBe('callback');
  });

  it('gameplay profile keeps callback mode', () => {
    const content = buildChoiceKeyboard({
      gamePrefix: 'rps',
      sessionId: 's1',
      narrative: '出拳',
      choices: [{ id: 'rock', label: '石头' }],
      interactionProfile: 'gameplay',
    });
    const kb = content[1] as { type: string; data: { rows: Array<Array<{ mode?: string }>> } };
    expect(kb.data.rows[0]?.[0]?.mode).toBe('callback');
  });
});

describe('resolveGameTextPayload integration', () => {
  it('accepts QQ-style prefill text for hub payload', async () => {
    const { resolveGameTextPayload } = await import('../src/game-interactive.js');
    expect(resolveGameTextPayload('@bot hub:scope1:g_ttt')).toBe('hub:scope1:g_ttt');
  });
});
