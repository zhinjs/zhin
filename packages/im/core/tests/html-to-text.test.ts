import { describe, expect, it } from 'vitest';
import { htmlToPlainText, htmlToPlainTextWithBlockBreaks, htmlToFallbackText } from '../src/built/html-to-text.js';

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

describe('htmlToFallbackText', () => {
  it('strips svg and adds block newlines', () => {
    const html = '<div>标题</div><div>120</div><svg><circle/></svg>';
    const text = htmlToFallbackText(html);
    expect(text).toContain('标题');
    expect(text).toContain('120');
    expect(text).not.toContain('<');
  });

  it('prefixes headings lightly', () => {
    expect(htmlToFallbackText('<h2>主机</h2><div>macOS</div>')).toContain('## 主机');
    expect(htmlToFallbackText('<h2>主机</h2><div>macOS</div>')).toContain('macOS');
  });

  it('converts list items to plain lines', () => {
    const text = htmlToFallbackText('<ul><li>Alice</li><li>Bob</li></ul>');
    expect(text).toContain('- Alice');
    expect(text).toContain('- Bob');
  });

  it('decodes entities', () => {
    expect(htmlToFallbackText('<div>a &amp; b &#39;c&#39;</div>')).toBe('a & b \'c\'');
  });
});
