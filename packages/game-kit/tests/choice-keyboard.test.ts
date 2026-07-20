import { describe, it, expect } from 'vitest';
import {
  buildChoiceKeyboard,
  buildChoiceFallbackMap,
  parseChoicePayload,
} from '../src/choice-keyboard.js';

describe('choice-keyboard', () => {
  describe('parseChoicePayload', () => {
    it('parses choice payload', () => {
      expect(parseChoicePayload('adv:s1:push_door', 'adv')).toEqual({
        prefix: 'adv',
        sessionId: 's1',
        choiceId: 'push_door',
      });
    });

    it('rejects wrong prefix', () => {
      expect(parseChoicePayload('adv:s1:go', 'ttt')).toBeNull();
    });
  });

  describe('buildChoiceFallbackMap', () => {
    it('maps numbered choices', () => {
      const map = buildChoiceFallbackMap('adv', 's1', [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', disabled: true },
        { id: 'c', label: 'C' },
      ]);
      expect(map).toEqual({
        '1': 'adv:s1:a',
        '2': 'adv:s1:c',
      });
    });
  });

  describe('buildChoiceKeyboard', () => {
    it('chunks buttons per row', () => {
      const content = buildChoiceKeyboard({
        gamePrefix: 'adv',
        sessionId: 's1',
        narrative: 'Hello',
        choices: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        buttonsPerRow: 2,
      });
      const kb = (content as Array<{ type: string; data: { rows: unknown[][] } }>)[1]!;
      expect(kb.data.rows).toHaveLength(2);
    });
  });
});
