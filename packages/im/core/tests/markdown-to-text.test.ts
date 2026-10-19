import { markdownToPlainText } from '../src/built/rich-segments/markdown-to-text.js';

describe('readable Markdown fallback', () => {
  it('preserves unclosed ordinary link prose, including the rest of the line', () => {
    expect(markdownToPlainText('[管理](unfinished 后续说明\n下一行')).toBe('[管理](unfinished 后续说明\n下一行');
    expect(markdownToPlainText('前缀 [说明](unfinished 后续文字')).toBe('前缀 [说明](unfinished 后续文字');
  });
  it('preserves list nesting, task state, ordered lists and table columns', () => {
    expect(markdownToPlainText('# 任务\n- [x] 已完成\n  - [ ] 待验证\n1. 发布\n| 任务 | 状态 |\n| --- | --- |\n| 早报 | 暂停 |'))
      .toBe('任务\n• [x] 已完成\n  • [ ] 待验证\n1. 发布\n| 任务 | 状态 |\n| --- | --- |\n| 早报 | 暂停 |');
  });

  it('keeps actionable destinations, nested labels, parentheses and image alt without media data', () => {
    expect(markdownToPlainText('[**管理**任务](https://example.org/my_task_(a) "管理")\n![结果图](data:image/png;base64,PRIVATE)'))
      .toBe('管理任务 (https://example.org/my_task_(a))\n[图片：结果图]');
    expect(markdownToPlainText('[https://example.org/a_b_c](https://example.org/a_b_c)'))
      .toBe('https://example.org/a_b_c');
    expect(markdownToPlainText('![结果 [说明](javascript:SECRET)](data:image/png;base64,PRIVATE)'))
      .toBe('[图片：结果 说明]');
    expect(markdownToPlainText('![结果](data:image/png;base64,PRIVATE')).toBe('[图片：结果]');
    expect(markdownToPlainText('[管理 &amp; 查询](https://example.org/?a=1&amp;b=2)'))
      .toBe('管理 & 查询 (https://example.org/?a=1&b=2)');
    expect(markdownToPlainText('`&amp; a_b`')).toBe('&amp; a_b');
  });

  it.each(['javascript:alert(1)', 'data:text/plain,PRIVATE', 'file:///etc/passwd', 'https://user:SECRET@example.org/'])(
    'drops unsafe or credential-bearing link destinations: %s', target => {
    expect(markdownToPlainText(`[查看](${target})`)).toBe('查看');
  });

  it('preserves literal code, including underscores, list markers and Markdown-looking links', () => {
    expect(markdownToPlainText('`a_b_c`\n```ts\nconst a_b = "**bold**";\n- [link](javascript:example)\n```'))
      .toContain('const a_b = "**bold**";\n- [link](javascript:example)');
    expect(markdownToPlainText('``a ` b``')).toBe('a ` b');
    expect(markdownToPlainText('~~~text\na_b_c\n~~~')).toContain('a_b_c');
  });

  it('accepts malformed large input and caps input work', () => {
    const punctuation = '['.repeat(300_000);
    expect(markdownToPlainText(punctuation)).toBe(punctuation);
    expect(markdownToPlainText('`'.repeat(300_000))).toBe('');
    const truncated = markdownToPlainText('x'.repeat(3 * 1024 * 1024));
    expect(truncated.startsWith('x'.repeat(2 * 1024 * 1024))).toBe(true);
    expect(truncated).toContain('已省略后续内容');
  });
});
