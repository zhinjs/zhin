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

  it('keeps link targets, nested labels, list hierarchy, table columns and image descriptions', () => {
    const text = htmlToFallbackText('<h2>任务</h2><ol start="3"><li>发布<ul><li>验证</li></ul></li></ol>'
      + '<table><tr><th>任务</th><th>状态</th></tr><tr><td>早报</td><td>暂停</td></tr></table>'
      + '<a href="https://example.org/tasks?a=1&amp;b=2"><b>管理</b>任务</a>'
      + '<img src="data:image/png;base64,PRIVATE" alt="执行结果 &amp; 说明">');
    expect(text).toContain('3. 发布');
    expect(text).toContain('  - 验证');
    expect(text).toContain('任务 | 状态');
    expect(text).toContain('早报 | 暂停');
    expect(text).toContain('管理任务 (https://example.org/tasks?a=1&b=2)');
    expect(text).toContain('[图片：执行结果 & 说明]');
    expect(text).not.toContain('PRIVATE');
  });

  it.each(['javascript:alert(1)', 'data:text/plain,PRIVATE', 'file:///etc/passwd',
    'https://user:SECRET@example.org/', 'java&#x73;cript:alert(1)', 'https://example.org/&#10;private'])(
    'does not expose unsafe or credential-bearing destinations: %s', href => {
    const text = htmlToFallbackText(`<a href="${href}">查看</a>`);
    expect(text).toBe('查看');
  });

  it('handles quoted angle brackets, full attribute names and literal code', () => {
    expect(htmlToFallbackText('<a data-href="https://wrong.example" title=">" href="https://example.org/x">查看</a>'))
      .toBe('查看 (https://example.org/x)');
    expect(htmlToFallbackText('<pre>if (a &lt; b) {\n  run();\n}</pre>')).toBe('if (a < b) {\n  run();\n}');
  });

  it('keeps bounded, malformed large input readable without scanning backwards', () => {
    const text = htmlToFallbackText('<table><tr><td>' + 'x'.repeat(300_000) + '</td><td>完成</td></tr></table>');
    expect(text).toHaveLength(300_005);
    expect(text.endsWith(' | 完成')).toBe(true);
    expect(htmlToFallbackText('<a href="' + 'x'.repeat(300_000))).toBe('');
  });
});
