import { jsx, renderToHtml } from '@zhin.js/jsx';
import { codeToTokens } from 'shiki';
import { CodeBlock } from '../src/code-block.js';

vi.mock('shiki', async (importOriginal) => ({
  ...await importOriginal<typeof import('shiki')>(),
  codeToTokens: vi.fn(),
}));

it('preserves Shiki strike-through and combined underline token styles', async () => {
  vi.mocked(codeToTokens).mockResolvedValue({
    tokens: [[{ content: 'strike', offset: 0, fontStyle: 8 }, { content: 'both', offset: 6, fontStyle: 12 }]],
    fg: '#111', bg: '#fff', themeName: 'github-light', rootStyle: '',
  });
  const html = await renderToHtml(jsx(CodeBlock, { source: 'strike both', language: 'text' }));
  expect(html).toContain('text-decoration: line-through');
  expect(html).toContain('text-decoration: underline line-through');
});
