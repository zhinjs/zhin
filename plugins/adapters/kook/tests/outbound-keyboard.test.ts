import { describe, expect, it } from 'vitest';
import { segment } from 'zhin.js';
import { coreKeyboardToKookCard, findKeyboardSegment } from '../src/outbound-keyboard.js';
import { convertToKookSendable } from '../src/outbound-sendable.js';

describe('kook outbound keyboard', () => {
  it('findKeyboardSegment isolates a single keyboard', () => {
    const kb = segment.keyboard([
      [segment.button({ id: 'ok', label: 'OK', payload: 'ok' })],
    ]);
    const found = findKeyboardSegment([
      { type: 'text', data: { text: 'choose' } },
      kb,
    ]);
    expect(found?.keyboard.data.rows).toHaveLength(1);
    expect(found?.rest).toHaveLength(1);
  });

  it('coreKeyboardToKookCard builds action-group buttons', () => {
    const kb = segment.keyboard([
      [segment.button({ id: 'go', label: 'Go', payload: 'go', style: 'primary' })],
    ]);
    const cards = coreKeyboardToKookCard(kb.data, [{ type: 'text', data: { text: 'Pick one' } }]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.modules).toEqual([
      { type: 'section', text: { type: 'plain-text', content: 'Pick one' } },
      {
        type: 'action-group',
        elements: [{
          type: 'button',
          theme: 'primary',
          value: 'go',
          click: 'return-val',
          text: { type: 'plain-text', content: 'Go' },
        }],
      },
    ]);
  });

  it('convertToKookSendable returns card payload for text + keyboard', () => {
    const kb = segment.keyboard([
      [segment.button({ id: 'x', label: 'X', payload: 'x' })],
    ]);
    const out = convertToKookSendable(
      [{ type: 'text', data: { text: 'hello' } }, kb],
      () => 'fallback',
    );
    expect(Array.isArray(out)).toBe(true);
    expect((out as Array<Record<string, unknown>>)[0]?.type).toBe('card');
  });
});
