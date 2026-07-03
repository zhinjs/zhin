import { describe, it, expect } from 'vitest';
import {
  splitLongTextForIm,
  expandOutboundBatchesForLongText,
} from '../../src/collaboration/group-message.js';

describe('splitLongTextForIm', () => {
  it('returns single chunk for short text', () => {
    expect(splitLongTextForIm('hello')).toEqual(['hello']);
  });

  it('splits long text without ellipsis', () => {
    const para1 = 'a'.repeat(2500);
    const para2 = 'b'.repeat(2500);
    const text = `${para1}\n\n${para2}`;
    const chunks = splitLongTextForIm(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n\n')).toBe(text);
    expect(chunks.every((c) => !c.endsWith('…'))).toBe(true);
  });
});

describe('expandOutboundBatchesForLongText', () => {
  it('splits long plain-text batch into multiple sends', () => {
    const long = 'x'.repeat(5000);
    const out = expandOutboundBatchesForLongText([[{ type: 'text', data: { text: ` ${long}` } }]], 4000);
    expect(out.length).toBeGreaterThan(1);
    const joined = out.map((b) => String(b[0]!.data!.text).trim()).join('');
    expect(joined).toBe(long);
  });

  it('keeps @ segment on first chunk only', () => {
    const long = 'y'.repeat(5000);
    const out = expandOutboundBatchesForLongText([[
      { type: 'at', data: { id: '123', qq: '123' } },
      { type: 'text', data: { text: ` ${long}` } },
    ]], 4000);
    expect(out[0]!.some((s) => s.type === 'at')).toBe(true);
    expect(out.slice(1).every((b) => !b.some((s) => s.type === 'at'))).toBe(true);
  });
});
