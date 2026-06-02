import { describe, expect, it } from 'vitest';
import { htmlToPlainText, htmlToPlainTextWithBlockBreaks } from '../src/built/html-to-text.js';

describe('htmlToPlainText', () => {
  it('removes script/style and tags', () => {
    const html = '<style>x{}</style><script>alert(1)</script><p>Hi <b>there</b></p>';
    expect(htmlToPlainText(html)).toBe('Hi there');
  });

  it('decodes common entities', () => {
    expect(htmlToPlainText('a &amp; b')).toBe('a & b');
  });
});

describe('htmlToPlainTextWithBlockBreaks', () => {
  it('preserves line breaks from block tags', () => {
    expect(htmlToPlainTextWithBlockBreaks('<p>one</p><p>two</p>')).toContain('one');
    expect(htmlToPlainTextWithBlockBreaks('<p>one</p><p>two</p>')).toContain('two');
  });
});
