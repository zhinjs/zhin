import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('documentation content insights loop', () => {
  it('documents collection, decisions, privacy, and verification in both languages', () => {
    const pages = [
      fs.readFileSync(path.join(repoRoot, 'docs/operations/docs-insights.md'), 'utf8'),
      fs.readFileSync(path.join(repoRoot, 'docs/en/operations/docs-insights.md'), 'utf8'),
    ];
    for (const page of pages) {
      for (const event of ['page_view', 'page_exit', 'not_found', 'search', 'search_no_results']) {
        expect(page).toContain(`\`${event}\``);
      }
      expect(page).toContain('VITE_DOCS_INSIGHTS_ENDPOINT');
      expect(page).toContain('DOCS_INSIGHTS_ENDPOINT');
      expect(page).toMatch(/weekly|每周/iu);
      expect(page).toMatch(/consent|同意/iu);
      expect(page).toMatch(/verify|验证/iu);
    }
  });
});
