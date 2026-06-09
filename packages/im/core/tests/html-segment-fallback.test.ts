import { describe, expect, it } from 'vitest';
import { coerceHtmlSegmentsToText } from '../src/built/html-segment-fallback.js';
import { segment } from '../src/utils.js';

describe('coerceHtmlSegmentsToText', () => {
  it('将 html 段转为 text 段', () => {
    const result = coerceHtmlSegmentsToText(
      segment.html({ html: '<div>Hello</div><div>World</div>' }),
    );
    const items = Array.isArray(result) ? result : [result];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'text' });
    expect((items[0] as { data: { text: string } }).data.text).toContain('Hello');
  });

  it('显式 text 优先于自动剥离', () => {
    const result = coerceHtmlSegmentsToText(
      segment.html({ html: '<div>ignored</div>', text: 'fallback' }),
    );
    const item = Array.isArray(result) ? result[0] : result;
    expect((item as { data: { text: string } }).data.text).toBe('fallback');
  });

  it('保留非 html 段', () => {
    const result = coerceHtmlSegmentsToText([
      segment.text('prefix'),
      segment.html({ html: '<div>card</div>' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'text', data: { text: 'prefix' } });
    expect(result[1]).toMatchObject({ type: 'text' });
  });
});
