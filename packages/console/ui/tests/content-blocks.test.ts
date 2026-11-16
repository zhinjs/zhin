import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Disclosure,
  KeyValueList,
  LoadingBlock,
  PageChromeProvider,
  ProgressMeter,
  RecordCard,
  Section,
  Sparkline,
  StatCard,
  createPageChromeStore,
  usePageChrome,
} from '../client/index.js';

const css = readFileSync(new URL('../client/styles/content-blocks.css', import.meta.url), 'utf8');

describe('content blocks (ADR 0063 P2)', () => {
  it('does not repeat the P1b layout components (sections, grids, stat cards, table cards)', async () => {
    const exports = await import('../client/index.js');
    for (const name of ['ContentSection', 'ContentGrid', 'MetricCard', 'ResponsiveTable']) expect(exports).not.toHaveProperty(name);
    const html = renderToStaticMarkup(h(Section, { title: '订阅', description: '说明', actions: h('span', null, '共 3 条'), id: 's', 'aria-label': '订阅' }, '内容'));
    expect(html).toContain('<h2');
    expect(html).toContain('id="s"');
    expect(css).not.toMatch(/console-(?:content-section|content-grid|metric-card|responsive-table)/u);
  });

  it('StatCard takes the declarative extras (image icon, unit, badge, footer)', () => {
    const html = renderToStaticMarkup(h(StatCard, { icon: '/a.png', label: '任务', value: 3, unit: '个', badge: h('span', null, 'B'), footer: h('span', null, 'F') }));
    expect(html).toContain('console-stat-icon');
    expect(html).toContain('console-stat-unit');
    expect(html).toContain('console-stat-head');
    expect(html).toContain('F');
  });

  it('RecordCard is a Card with a one-column key / value list', () => {
    const html = renderToStaticMarkup(h(RecordCard, { title: 'A', fields: [{ key: 'k', label: '状态', value: '运行中' }] }));
    expect(html).toContain('console-card ');
    expect(html).toContain('console-kv is-cols-1');
  });

  it('LoadingBlock sizes its lines with component classes, not utility classes', () => {
    const html = renderToStaticMarkup(h(LoadingBlock, { label: '加载中…' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('console-skeleton-line');
    expect(html).not.toMatch(/\bh-4\b|\bw-full\b/u);
  });

  it('follows the container (`.console-cq`), never the viewport', () => {
    expect(css).not.toMatch(/@media/u);
    expect(css).toMatch(/@container console \(width < 40rem\)/u);
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
