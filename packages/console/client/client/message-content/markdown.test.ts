import { highlightCodeLine, isSafeMarkdownHref, parseMarkdown, parseMarkdownInline } from './markdown.js';

describe('message markdown', () => {
  it('parses rich blocks including tables and tasks', () => {
    const blocks = parseMarkdown(`# Result

- [x] inspect runtime
- [ ] publish patch

| field | value |
| --- | --- |
| status | **ready** |`);

    expect(blocks.map((block) => block.type)).toEqual(['heading', 'list', 'table']);
    expect(blocks[1]).toMatchObject({ type: 'list', items: [{ checked: true }, { checked: false }] });
  });

  it('keeps incomplete streaming fences renderable', () => {
    expect(parseMarkdown('```ts\nconst ready = true')).toEqual([
      { type: 'code', language: 'ts', value: 'const ready = true', closed: false },
    ]);
  });

  it('rejects unsafe markdown links without emitting active links', () => {
    expect(isSafeMarkdownHref('javascript:alert(1)')).toBe(false);
    expect(isSafeMarkdownHref('https://zhin.dev/docs')).toBe(true);
    expect(parseMarkdownInline('[run](javascript:alert(1))')).toEqual([
      { type: 'text', value: '[run](javascript:alert(1))' },
    ]);
  });

  it('treats repeated unmatched link openers as plain text', () => {
    const value = '['.repeat(20_000);
    expect(parseMarkdownInline(value)).toEqual([{ type: 'text', value }]);
  });

  it('tokenizes common code without producing html', () => {
    expect(highlightCodeLine('const answer = "<safe>" // note', 'ts')).toEqual([
      { kind: 'keyword', value: 'const' },
      { kind: 'plain', value: ' ' },
      { kind: 'plain', value: 'answer' },
      { kind: 'plain', value: ' = ' },
      { kind: 'string', value: '"<safe>"' },
      { kind: 'plain', value: ' ' },
      { kind: 'comment', value: '// note' },
    ]);
  });
});
