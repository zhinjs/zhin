import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-expect-error — plain ESM modules without declarations
import * as tokens from '../tokens/tokens.mjs';
// @ts-expect-error — plain ESM modules without declarations
import { buildScale, resolveSemanticValue } from '../tokens/scale.mjs';
// @ts-expect-error — plain ESM modules without declarations
import { generate, themeCss, tokensCss } from '../tokens/generate.mjs';
import {
  Badge, Card, Grid, PageHeader, PageShell, StatGrid, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  isAttentionStatus,
} from '../client/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rem = (value: string) => (value.endsWith('rem') ? Number.parseFloat(value) * 16 : Number.parseFloat(value));

describe('token source (ADR 0063 D16, D17)', () => {
  it('generated files are up to date (never edited by hand)', () => {
    expect(generate({ check: true })).toEqual([]);
  });

  it('base scale: ≤ 5 sizes, ≤ 3 weights, 8 spacing steps on the 4px grid mapped to Tailwind keys', () => {
    expect(Object.keys(tokens.text)).toEqual(['label', 'body', 'section', 'title', 'display']);
    expect(Object.keys(tokens.weight)).toEqual(['regular', 'medium', 'strong']);
    const space = Object.values(tokens.space) as { value: string; tailwind: string }[];
    expect(space.map((entry) => entry.value)).toEqual(['0.25rem', '0.5rem', '0.75rem', '1rem', '1.5rem', '2rem', '3rem', '4rem']);
    expect(space.map((entry) => entry.tailwind)).toEqual(['1', '2', '3', '4', '6', '8', '12', '16']);
    for (const entry of space) expect(rem(entry.value)).toBe(Number(entry.tailwind) * 4);
    expect(tokens.breakpoints).toEqual({ sm: '40rem', md: '48rem', lg: '64rem', xl: '90rem' });
    expect(tokens.contentWidth).toEqual({ reading: '60rem', data: '120rem' });
  });

  it('semantic values follow the D16 「按尺寸取值」 table', () => {
    const at = (name: string) => tokens.semantic[name];
    expect(at('page-padding-inline')).toMatchObject({ scope: 'viewport', base: 'space-3', sm: 'space-4', lg: 'clamp(space-4, 2.5vw, space-6)' });
    expect(at('section-gap')).toMatchObject({ base: 'space-4', sm: 'space-5', lg: 'space-6' });
    expect(at('stack-gap')).toMatchObject({ base: 'space-2', sm: 'space-3', lg: 'space-3' });
    expect(at('card-padding')).toMatchObject({ base: 'space-3', sm: 'space-4', lg: 'space-4' });
    expect(at('card-radius')).toMatchObject({ base: 'r-2', sm: 'r-3', lg: 'r-3' });
    expect(at('list-row-padding')).toMatchObject({ base: 'space-3', sm: 'space-2', lg: 'space-2' });
    expect(at('control-height')).toMatchObject({ base: '2.75rem', sm: '2.25rem', lg: '2.25rem' });
    expect(at('control-height-compact')).toMatchObject({ lg: '2rem' });
    expect(at('popover-radius').base).toBe('r-4 r-4 r-0 r-0');
    expect(at('popover-elevation')).toMatchObject({ base: 'e-3', sm: 'e-2', lg: 'e-2' });
    expect(resolveSemanticValue('clamp(space-4, 2.5vw, space-6)')).toBe('clamp(var(--console-space-4), 2.5vw, var(--console-space-6))');
  });

  it('group spacing < card padding ≤ section gap at every width (D18 第 2 条)', () => {
    const value = (name: string, size: 'base' | 'sm' | 'lg') => rem(tokens.space[tokens.semantic[name][size]].value);
    for (const size of ['base', 'sm', 'lg'] as const) {
      expect(value('stack-gap', size)).toBeLessThanOrEqual(value('card-padding', size));
      expect(value('card-padding', size)).toBeLessThanOrEqual(value('section-gap', size));
    }
  });

  it('nested radii: inner = outer − padding (D16 配套规则)', () => {
    const radius = (name: string) => rem(tokens.radius[name]);
    const space = (name: string) => rem(tokens.space[name].value);
    for (const size of ['base', 'sm', 'lg'] as const) {
      const outer = radius(String(tokens.semantic['popover-radius'][size]).split(' ')[0]);
      const inner = radius(tokens.semantic['popover-item-radius'][size]);
      expect(inner).toBe(Math.max(0, outer - space(tokens.semantic['popover-padding'][size])));
    }
    expect(radius('r-2') - space('space-1')).toBe(radius(tokens.semantic['segment-radius'].lg));
  });

  it('the Tailwind theme only offers on-scale keys and keeps sizing separate', () => {
    const theme = themeCss();
    for (const reset of ['--spacing: initial;', '--spacing-*: initial;', '--text-*: initial;', '--radius-*: initial;', '--shadow-*: initial;', '--breakpoint-*: initial;']) {
      expect(theme).toContain(reset);
    }
    const spacing = [...theme.matchAll(/--spacing-([\w.\\]+):/gu)].map((match) => match[1]);
    expect(spacing).toEqual(['0', '1', '2', '3', '4', '6', '8', '12', '16']);
    expect(theme).toContain('--height-11: 2.75rem;');
    expect(theme).toContain('--radius-control: var(--console-control-radius);');
    expect(theme).toContain('--shadow-e2: var(--console-elevation-2);');
    expect(buildScale().tailwind.spacingKeys).toEqual(['0', 'px', '1', '2', '3', '4', '6', '8', '12', '16']);
  });

  it('motion: three durations and one easing curve; the old duration names were removed in P4 (zhinjs/console#125)', () => {
    expect(tokens.motion).toEqual({ 'motion-fast': '120ms', 'motion-base': '200ms', 'motion-slow': '280ms' });
    expect(tokens.misc['ease-out']).toBe('cubic-bezier(0.25, 1, 0.5, 1)');
    expect(tokens.removedAliases).toMatchObject({ 'duration-fast': 'motion-fast', 'duration-page': 'motion-base' });
    expect(tokensCss()).not.toMatch(/--console-duration-/u);
    const theme = themeCss();
    expect(theme).toContain('--default-transition-duration: var(--console-motion-fast);');
    expect(theme).toContain('--default-transition-timing-function: var(--console-ease-out);');
    expect(theme).toContain('--color-brand: hsl(var(--console-brand));');
    expect(theme).toContain('--color-signal-warning-fill: hsl(var(--console-signal-warning-fill));');
    expect(tokens.composite['focus-ring']).toContain('--console-brand-text');
  });

  it('publishes the scale for the linters, plugin check and the audit', () => {
    const json = JSON.parse(readFileSync(join(packageRoot, 'client/styles/generated/scale.json'), 'utf8'));
    expect(json).toEqual(JSON.parse(JSON.stringify(buildScale())));
    expect(json.css.customMedia['--console-sm']).toBe('(min-width: 40rem)');
  });
});

describe('components (ADR 0063 D15, D18)', () => {
  it('「正常」 is muted text, never a colored badge', () => {
    expect(isAttentionStatus('ok')).toBe(false);
    expect(isAttentionStatus('error')).toBe(true);
    const ok = renderToStaticMarkup(h(StatusBadge, { status: 'ok' }, '正常'));
    expect(ok).toContain('console-status-quiet');
    expect(ok).not.toContain('console-badge');
    expect(renderToStaticMarkup(h(StatusBadge, { status: 'warning' }, '拉取失败'))).toContain('console-badge-warning');
    expect(renderToStaticMarkup(h(Badge, { variant: 'success' }, '正常'))).toContain('console-status-quiet');
  });

  it('PageShell resolves the content width and is a size container', () => {
    const data = renderToStaticMarkup(h(PageShell, null, 'x'));
    expect(data).toContain('console-page-frame console-cq');
    expect(data).toContain('data-width="data"');
    expect(renderToStaticMarkup(h(PageShell, { width: 'reading' }, 'x'))).toContain('data-width="reading"');
    expect(renderToStaticMarkup(h(PageShell, { inset: false }, 'x'))).toContain('data-inset="false"');
  });

  it('page header, tables and stat grids are containers; tables mark priority columns', () => {
    expect(renderToStaticMarkup(h(PageHeader, { title: 't' }))).toContain('console-page-header console-cq');
    expect(renderToStaticMarkup(h(StatGrid, { label: 's' }, 'x'))).toContain('class="console-cq"');
    const table = renderToStaticMarkup(h(Table, null,
      h(TableHeader, null, h(TableRow, null, h(TableHead, { priority: 'secondary' }, '推送到'))),
      h(TableBody, null, h(TableRow, null, h(TableCell, { priority: 'secondary', label: '推送到', numeric: true }, '1')))));
    expect(table).toContain('console-table console-cq');
    expect(table).toContain('data-priority="secondary"');
    expect(table).toContain('data-label="推送到"');
    expect(table).toContain('data-numeric=""');
  });

  it('cards: static by default, edge cards marked; grids pass their minimum column', () => {
    expect(renderToStaticMarkup(h(Card, { edge: true }))).toContain('data-edge=""');
    expect(renderToStaticMarkup(h(Card, { interactive: true }))).toContain('data-interactive=""');
    expect(renderToStaticMarkup(h(Grid, { min: '20rem' }, 'x'))).toContain('--grid-min:20rem');
  });
});
