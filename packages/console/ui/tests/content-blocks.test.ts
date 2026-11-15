import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContentGrid,
  ContentSection,
  Disclosure,
  KeyValueList,
  MetricCard,
  PageChromeProvider,
  ProgressMeter,
  RecordCard,
  ResponsiveTable,
  Sparkline,
  createPageChromeStore,
  usePageChrome,
} from '../client/index.js';

const css = readFileSync(new URL('../client/styles/content-blocks.css', import.meta.url), 'utf8');

describe('content blocks (ADR 0063 P2)', () => {
  it('renders a section with an h2, never an h1 (the page title belongs to the shell)', () => {
    const html = renderToStaticMarkup(h(ContentSection, { title: '订阅', description: '说明', actions: h('span', null, '共 3 条') }, '内容'));
    expect(html).toContain('<h2');
    expect(html).not.toContain('<h1');
    expect(html).toContain('共 3 条');
  });

  it('grids flow with auto-fit and keep two stat cards per row in a narrow container', () => {
    expect(renderToStaticMarkup(h(ContentGrid, { min: 'stat' }, h(MetricCard, { label: '任务', value: 3 })))).toContain('is-min-stat');
    expect(css).toMatch(/repeat\(auto-fit, minmax\(/u);
    expect(css).toMatch(/@container \(max-width: 40rem\)\s*\{\s*\.console-content-grid\.is-min-stat \{ grid-template-columns: repeat\(2/u);
  });

  it('switches a table to cards in a container narrower than sm, not by the viewport', () => {
    const html = renderToStaticMarkup(h(ResponsiveTable, { table: h('table', null), cards: h(RecordCard, { title: 'A', fields: [{ key: 'k', label: '状态', value: '运行中' }] }) }));
    expect(html).toContain('console-responsive-table-wide');
    expect(html).toContain('console-responsive-table-narrow');
    expect(css).not.toMatch(/@media/u);
    expect(css).toMatch(/@container \(max-width: 40rem\)\s*\{\s*\.console-responsive-table-wide \{ display: none; \}/u);
  });

  it('keeps raw content collapsed unless asked and marks muted values', () => {
    expect(renderToStaticMarkup(h(Disclosure, { summary: 'JSON' }, 'x'))).not.toContain('open');
    expect(renderToStaticMarkup(h(Disclosure, { summary: 'JSON', defaultOpen: true }, 'x'))).toContain('open');
    expect(renderToStaticMarkup(h(KeyValueList, { items: [{ label: '计划', value: '09:00', muted: true }] }))).toContain('data-muted="true"');
  });

  it('progress and sparkline are accessible and bounded', () => {
    expect(renderToStaticMarkup(h(ProgressMeter, { value: 150, showValue: true, label: '进度' }))).toContain('aria-valuenow="100"');
    expect(renderToStaticMarkup(h(Sparkline, { values: [1] }))).toBe('');
  });

  it('page chrome carries title and description to the shell', () => {
    const store = createPageChromeStore();
    function Page() {
      usePageChrome({ title: 'RSS', description: '订阅' });
      return null;
    }
    renderToStaticMarkup(h(PageChromeProvider, { store }, h(Page)));
    // Effects do not run in static rendering; the store contract is exercised directly.
    const release = store.set({ title: 'RSS', description: '订阅' });
    expect(store.get()).toMatchObject({ title: 'RSS', description: '订阅' });
    release();
    expect(store.get()).toBeUndefined();
  });

  it('uses only tokens for spacing, radii and type (no px literals)', () => {
    for (const declaration of css.match(/(?:gap|padding[a-z-]*|margin[a-z-]*|border-radius|font-size)\s*:[^;]+;/gu) ?? []) {
      expect(declaration, declaration).not.toMatch(/\d+px/u);
    }
  });
});
