import { markdownToTelegramHtml, projectTelegramMarkdown } from '../src/markdown-to-html.js';
import { sliceTelegramMarkdown } from '../src/stream-markdown.js';
import { telegramHtmlText as visible } from './telegram-html-text.js';

function pieces(markdown: string, capacity: number) {
  let preceding = '';
  const result: Array<ReturnType<typeof sliceTelegramMarkdown>> = [];
  while (preceding.length < markdown.length) {
    const next = sliceTelegramMarkdown(markdown.slice(preceding.length), preceding, capacity);
    expect(next.acceptedText.length).toBeGreaterThan(0);
    expect(Array.from(visible(next.html)).length).toBeLessThanOrEqual(capacity);
    result.push(next);
    preceding += next.acceptedText;
    expect(result.length).toBeLessThanOrEqual(markdown.length);
  }
  expect(result.map(part => part.acceptedText).join('')).toBe(markdown);
  expect(result.map(part => visible(part.html)).join('')).toBe(visible(markdownToTelegramHtml(markdown).trim()));
  return result;
}

describe('Telegram Markdown source-preserving rollover', () => {
  it.each([
    ['**abcdefghij**', 'b'],
    ['*abcdefghij*', 'i'],
    ['~~abcdefghij~~', 's'],
  ])('preserves inline formatting on every physical slice: %s', (markdown, tag) => {
    expect(pieces(markdown, 4).map(part => part.html)).toEqual([
      `<${tag}>abcd</${tag}>`, `<${tag}>efgh</${tag}>`, `<${tag}>ij</${tag}>`,
    ]);
  });

  it.each([
    '# Header\n\nplain **bold** *italic* ~~strike~~ & <escaped>',
    'before [report](https://example.invalid/report?a=1&b=2) after',
    '> quoted **bold**\n\n- bullet\n- another',
    '```typescript\nconst value = "<&>";\n```\n\nafter',
    '__bold__ and _italic_ with `inline <code>`',
    'emoji 😀😀 and 中文段落\n\nend',
  ])('keeps projection and source unchanged across tiny containers: %s', markdown => {
    const projection = projectTelegramMarkdown(markdown);
    expect(projection.html).toBe(markdownToTelegramHtml(markdown));
    expect(projection.source).toHaveLength(projection.html.length);
    pieces(markdown, 7);
  });

  it('reopens a long fenced code block with its language while consuming the original source once', () => {
    const result = pieces(`\`\`\`typescript\n${'const value = 1;\n'.repeat(700)}\`\`\``, 4096);
    expect(result.length).toBeGreaterThan(2);
    for (const part of result) {
      expect(part.html).toMatch(/^<pre><code class="language-typescript">/);
      expect(part.html).toMatch(/<\/code><\/pre>$/);
    }
  });

  it('keeps the href of a link whose label spans several physical messages', () => {
    const result = pieces(`[${'report😀'.repeat(1800)}](https://example.invalid/report)`, 4096);
    expect(result.length).toBeGreaterThan(2);
    for (const part of result) {
      expect(part.html).toMatch(/^<a href="https:\/\/example.invalid\/report">/);
      expect(part.html).toMatch(/<\/a>$/);
    }
  });
});
