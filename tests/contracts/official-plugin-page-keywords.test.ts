/**
 * ADR 0063 P3（zhin 侧）：官方插件页面都声明命令面板别名 `keywords`（中英文各一组），
 * 且不再写 `section`（插件页面挂到插件详情页签；Sandbox 例外，由 Console 的 PLUGIN_PAGE_PLACEMENT 放置）。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pageKeywordsFor, type PageMetadata } from '../../packages/console/plugin-contract/src/page.js';
import { listOfficialPluginsWithPages } from '../../scripts/lib/plugin-ui-gate.mjs';
import { listPluginPages } from '../../scripts/check-plugin-ui-audit.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
/** Sandbox's page metadata belongs to the Sandbox migration (ADR 0063 D13). */
const OUTSIDE_THIS_CHECK = new Set(['plugins/adapters/sandbox']);

const pages = listOfficialPluginsWithPages(repoRoot)
  .filter((plugin) => !OUTSIDE_THIS_CHECK.has(plugin))
  .flatMap((plugin) => listPluginPages(path.join(repoRoot, plugin)).map((page) => ({ plugin, ...page })));

describe('official plugin pages: command palette keywords (ADR 0063 P3)', () => {
  it('finds the official plugin pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(30);
  });

  it.each(pages)('$plugin $entry declares keywords for zh-CN and en and no section', async ({ plugin, entry }) => {
    const module = await import(pathToFileURL(path.join(repoRoot, plugin, entry)).href) as { meta?: PageMetadata };
    expect(module.meta, 'page must export meta = definePage({...})').toBeDefined();
    const meta = module.meta!;
    expect(meta.section).toBeUndefined();
    for (const locale of ['zh-CN', 'en'] as const) {
      const keywords = pageKeywordsFor(meta.keywords, locale);
      expect(keywords.length, `${locale} keywords`).toBeGreaterThan(0);
      const title = (locale === 'en' ? meta.titleI18n?.en : undefined) ?? meta.title;
      // Aliases add search terms; repeating the title adds nothing.
      expect(keywords.map((keyword) => keyword.toLowerCase())).not.toContain(title?.toLowerCase());
    }
  }, 30_000);
});
