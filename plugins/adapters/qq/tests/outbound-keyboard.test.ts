import { describe, expect, it } from 'vitest';
import { segment } from 'zhin.js';
import { expandKeyboardSegmentsForQq } from '../src/outbound-keyboard.js';

describe('expandKeyboardSegmentsForQq', () => {
  it('converts keyboard rows to qq button segments with leading markdown', () => {
    const out = expandKeyboardSegmentsForQq([
      segment.text('井字棋'),
      segment.keyboard([
        [
          segment.button({ id: 'a', label: '·', payload: 'game:0' }),
          segment.button({ id: 'b', label: '✕', payload: 'game:1', disabled: true }),
        ],
      ]),
    ]);

    expect(Array.isArray(out)).toBe(true);
    const items = out as Array<{ type: string; data: Record<string, unknown> }>;
    expect(items[0]?.type).toBe('markdown');
    expect(items[1]?.type).toBe('button');
    const buttons = items[1]?.data.buttons as Array<{ action: { data: string; click_limit: number } }>;
    expect(buttons[0]?.action.data).toBe('game:0');
    expect(buttons[1]?.action.click_limit).toBe(0);
  });
});
