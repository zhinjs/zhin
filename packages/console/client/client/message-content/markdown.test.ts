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

  describe('complete Markdown (ADR 0064 G5)', () => {
    it('parses inline images and keeps unsafe image sources as text', () => {
      expect(parseMarkdownInline('see ![chart](https://example.com/c.png) here')).toEqual([
        { type: 'text', value: 'see ' },
        { type: 'image', value: 'chart', src: 'https://example.com/c.png' },
        { type: 'text', value: ' here' },
      ]);
      for (const source of ['![x](javascript:alert(1))', '![x](data:image/svg+xml;base64,PHN2Zz4=)', '![x](data:text/html;base64,PGI+)']) {
        expect(parseMarkdownInline(source).every((token) => token.type === 'text')).toBe(true);
      }
    });

    it('nests inline formatting inside links, emphasis and strike', () => {
      expect(parseMarkdownInline('[**docs** page](https://zhin.dev)')).toEqual([
        { type: 'link', value: 'docs page', href: 'https://zhin.dev', children: [
          { type: 'strong', value: 'docs' }, { type: 'text', value: ' page' },
        ] },
      ]);
      expect(parseMarkdownInline('**bold *it* [x](https://a.b)**')).toEqual([
        { type: 'strong', value: 'bold it x', children: [
          { type: 'text', value: 'bold ' }, { type: 'emphasis', value: 'it' }, { type: 'text', value: ' ' },
          { type: 'link', value: 'x', href: 'https://a.b' },
        ] },
      ]);
      expect(parseMarkdownInline('*it **b** it*')).toEqual([
        { type: 'emphasis', value: 'it b it', children: [
          { type: 'text', value: 'it ' }, { type: 'strong', value: 'b' }, { type: 'text', value: ' it' },
        ] },
      ]);
      expect(parseMarkdownInline('***both***')).toEqual([
        { type: 'strong', value: 'both', children: [{ type: 'emphasis', value: 'both' }] },
      ]);
      expect(parseMarkdownInline('~~**gone**~~')).toEqual([
        { type: 'strike', value: 'gone', children: [{ type: 'strong', value: 'gone' }] },
      ]);
      expect(parseMarkdownInline('[![badge](https://img.example/b.png)](https://example.com)')).toEqual([
        { type: 'link', value: 'badge', href: 'https://example.com', children: [
          { type: 'image', value: 'badge', src: 'https://img.example/b.png' },
        ] },
      ]);
    });

    it('keeps snake_case and unmatched delimiters literal', () => {
      expect(parseMarkdownInline('call snake_case_name now')).toEqual([{ type: 'text', value: 'call snake_case_name now' }]);
      expect(parseMarkdownInline('2 * 3 * 4')).toEqual([{ type: 'text', value: '2 * 3 * 4' }]);
      expect(parseMarkdownInline('**open\n**bold**')).toEqual([
        { type: 'text', value: '**open\n' }, { type: 'strong', value: 'bold' },
      ]);
    });

    it('stays linear on long runs of unmatched delimiters', () => {
      for (const value of ['*'.repeat(20_000), '_a'.repeat(10_000), '**x\n'.repeat(5_000), '!['.repeat(10_000), '`'.repeat(20_000)]) {
        const started = performance.now();
        expect(parseMarkdownInline(value).map((token) => token.value).join('')).toBe(value);
        expect(performance.now() - started).toBeLessThan(1_000);
      }
    });

    it('parses nested lists into item children', () => {
      const [list] = parseMarkdown('- one\n  - one.a\n    1. deep\n  - one.b\n- two\n  continued');
      expect(list).toEqual({ type: 'list', ordered: false, items: [
        { content: [{ type: 'text', value: 'one' }], children: [
          { type: 'list', ordered: false, items: [
            { content: [{ type: 'text', value: 'one.a' }], children: [
              { type: 'list', ordered: true, items: [{ content: [{ type: 'text', value: 'deep' }] }] },
            ] },
            { content: [{ type: 'text', value: 'one.b' }] },
          ] },
        ] },
        { content: [{ type: 'text', value: 'two' }], children: [
          { type: 'paragraph', content: [{ type: 'text', value: 'continued' }] },
        ] },
      ] });
    });
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
