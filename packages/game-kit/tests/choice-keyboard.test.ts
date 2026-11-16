import { describe, it, expect } from 'vitest';
import {
  buildChoiceKeyboard,
  buildChoiceFallbackMap,
  parseChoicePayload,
} from '../src/choice-keyboard.js';
import { resolveGameTextPayload } from '../src/game-interactive.js';
import { buildGridKeyboard, buildGridFallbackMap, type GridCell } from '../src/grid-keyboard.js';
import { renderKeyboardAsText } from '@zhin.js/core';

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
      // 序号跳过 disabled；按钮文字（归一化后）同样命中，disabled 的文字不命中（#1250）。
      expect(map).toEqual({
        '1': 'adv:s1:a',
        '2': 'adv:s1:c',
        a: 'adv:s1:a',
        c: 'adv:s1:c',
      });
    });
  });

  describe('button label text (#1250 game-button-label-text-not-accepted)', () => {
    const choices = [
      { id: 'hit', label: '➕ 要牌' },
      { id: 'stand', label: '✋ 停牌' },
      { id: 'quit', label: '🏳️ 放弃' },
    ];
    const map = buildChoiceFallbackMap('bj', 's1', choices);

    it('accepts the ordinal and the label text, ignoring emoji, whitespace and case', () => {
      expect(resolveGameTextPayload('1', map)).toBe('bj:s1:hit');
      expect(resolveGameTextPayload('要牌', map)).toBe('bj:s1:hit');
      expect(resolveGameTextPayload(' 停 牌 ', map)).toBe('bj:s1:stand');
      expect(resolveGameTextPayload('🏳️放弃', map)).toBe('bj:s1:quit');
      expect(resolveGameTextPayload('要牌吗', map)).toBeUndefined();
      expect(resolveGameTextPayload('4', map)).toBeUndefined();
      const en = buildChoiceFallbackMap('bj', 's1', [{ id: 'hit', label: '➕ Hit' }]);
      expect(resolveGameTextPayload('hit', en)).toBe('bj:s1:hit');
    });

    it('adds one reply-hint line to the card and keeps label keys out of the rendered keyboard', () => {
      const content = buildChoiceKeyboard({ gamePrefix: 'bj', sessionId: 's1', narrative: '目标 21', choices }) as
        Array<{ data: { text?: string; fallback?: { hint: string; map: Record<string, string>; layout?: string } } }>;
      expect(content[0]!.data.text).toBe('目标 21\n回复序号或按钮文字也可以');
      expect(content[1]!.data.fallback).toEqual({ hint: '', layout: 'inline',
        map: { '1': 'bj:s1:hit', '2': 'bj:s1:stand', '3': 'bj:s1:quit' } });
      const en = buildChoiceKeyboard({ gamePrefix: 'bj', sessionId: 's1', narrative: 'x', choices, locale: 'en' }) as Array<{ data: { text?: string } }>;
      expect(en[0]!.data.text).toBe('x\nYou can also reply with the number or the button text');
      const labelOnly = buildChoiceKeyboard({ gamePrefix: 'g', sessionId: 's1', narrative: 'x', choices, replyHint: 'label' }) as Array<{ data: { text?: string } }>;
      expect(labelOnly[0]!.data.text).toBe('x\n回复按钮文字也可以');
      const none = buildChoiceKeyboard({ gamePrefix: 'g', sessionId: 's1', narrative: 'x', choices, replyHint: false }) as Array<{ data: { text?: string } }>;
      expect(none[0]!.data.text).toBe('x');
      const finished = buildChoiceKeyboard({ gamePrefix: 'g', sessionId: 's1', narrative: 'x', choices, terminal: true }) as Array<{ data: { text?: string } }>;
      expect(finished[0]!.data.text).toBe('x');
    });

    it('renders the buttons as one numbered line on endpoints without buttons', () => {
      const content = buildChoiceKeyboard({ gamePrefix: 'bj', sessionId: 's1', narrative: 'x',
        choices: [{ id: 'hit', label: '要牌' }, { id: 'stand', label: '停牌' }, { id: 'quit', label: '放弃' }] }) as
        Array<{ data: Parameters<typeof renderKeyboardAsText>[0] }>;
      expect(renderKeyboardAsText(content[1]!.data)).toBe('1. 要牌  2. 停牌  3. 放弃');
    });

    it('numbers grid cells by board position when asked, so 1–9 always means the same cell', () => {
      const cells: GridCell[] = Array.from({ length: 9 }, (_, i) => ({ state: i, label: '·', disabled: i === 0 || i === 4 }));
      const map = buildGridFallbackMap('ttt', 's1', cells, 'position');
      expect(map['1']).toBeUndefined();
      expect(map['2']).toBe('ttt:s1:1');
      expect(map['9']).toBe('ttt:s1:8');
      const content = buildGridKeyboard({ gamePrefix: 'ttt', sessionId: 's1', rows: 3, cols: 3, cells, statusLine: 's',
        numbering: 'position', terminal: true, postChoices: [{ id: 'restart', label: '再来一局' }] }) as
        Array<{ data: { text?: string; fallback?: { map: Record<string, string> } } }>;
      expect(content[1]!.data.fallback!.map['10']).toBe('ttt:s1:restart');
      expect(content[0]!.data.text).toBe('s\n回复序号或按钮文字也可以');
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
