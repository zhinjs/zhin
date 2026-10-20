import { describe, expect, it } from 'vitest';
import { stripHtml } from '../src/feed.js';

describe('stripHtml (linear scanner)', () => {
  it('removes tags, converts &nbsp; and collapses whitespace', () => {
    expect(stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World');
    expect(stripHtml('a&nbsp;&nbsp;b')).toBe('a b');
    expect(stripHtml('  多空格   折叠  ')).toBe('多空格 折叠');
    expect(stripHtml('<div>\n  段落 &nbsp;文本\n</div>')).toBe('段落 文本');
  });

  it('keeps unclosed `<` as literal text (same as legacy regex)', () => {
    expect(stripHtml('a <b')).toBe('a <b');
    // 有闭合 `>` 时按标签剔除（与旧 `<[^>]*>` 行为一致）。
    expect(stripHtml('1 < 2 且 3 > 2')).toBe('1 2');
  });

  it('strips nested-looking tags in a single pass', () => {
    expect(stripHtml('<scr<script>ipt>alert</script>')).toBe('ipt>alert');
  });

  it('handles 100k `<` without `>` in linear time (no ReDoS)', () => {
    const input = '<'.repeat(100_000);
    const start = performance.now();
    const result = stripHtml(input);
    expect(performance.now() - start).toBeLessThan(100);
    expect(result).toBe(input);
  });

  it('handles 100k `<a` fragments without closing `>` in linear time', () => {
    const input = '<a'.repeat(50_000);
    const start = performance.now();
    const result = stripHtml(input);
    expect(performance.now() - start).toBeLessThan(100);
    expect(result).toBe(input);
  });
});
