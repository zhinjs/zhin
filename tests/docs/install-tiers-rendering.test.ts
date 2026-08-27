import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function extractRegion(markdown: string, region: string): string {
  const match = markdown.match(
    new RegExp(`<!-- #region ${region} -->\\n([\\s\\S]*?)\\n<!-- #endregion ${region} -->`),
  );
  if (!match) throw new Error(`Markdown region not found: ${region}`);
  return match[1].trim();
}

describe('Install tiers Markdown includes', () => {
  it.each([
    {
      pagePath: 'docs/getting-started/index.md',
      includePath: '../snippets/install-tiers.md',
      region: 'tiers-table',
      tableHeader: '| 档位 | 安装 | 约 production 体积 | 能力 |',
    },
    {
      pagePath: 'docs/en/getting-started/index.md',
      includePath: '../../snippets/install-tiers.md',
      region: 'tiers-table-en',
      tableHeader: '| Tier | Install | ~production size | Capabilities |',
    },
  ])('renders the table as Markdown in $pagePath', ({ pagePath, includePath, region, tableHeader }) => {
    const page = readRepoFile(pagePath);
    const directive = `<!--@include: ${includePath}#${region}-->`;

    expect(page).toContain(directive);
    expect(page).not.toMatch(/```md\s*<<<[^\n]*install-tiers\.md/);

    const snippetPath = resolve(repoRoot, dirname(pagePath), includePath);
    const snippet = readFileSync(snippetPath, 'utf8');
    expect(extractRegion(snippet, region)).toContain(tableHeader);
  });
});
