import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

  it('base scale (soft cards D35, D36): 8 sizes, 3 weights, the 4px grid mapped to Tailwind keys', () => {
    const sizes = Object.fromEntries(Object.entries(tokens.text as Record<string, { size: string; leading: string }>).map(([name, { size, leading }]) => [name, `${rem(size)}/${rem(leading)}`]));
    expect(sizes).toEqual({ xs: '12/16', sm: '13/18', md: '14/20', lg: '15/22', xl: '17/24', '2xl': '22/30', title: '26/34', display: '32/40' });
    // The D16 names stay as aliases of the new sizes.
    expect(tokens.textAliases).toEqual({ label: 'sm', body: 'md', section: 'xl' });
    expect(Object.keys(tokens.weight)).toEqual(['regular', 'medium', 'strong']);
    const space = Object.values(tokens.space) as { value: string; tailwind: string }[];
    expect(space.map((entry) => rem(entry.value))).toEqual([4, 8, 12, 16, 20, 24, 32, 40, 48, 64]);
    expect(space.map((entry) => entry.tailwind)).toEqual(['1', '2', '3', '4', '5', '6', '8', '10', '12', '16']);
    for (const entry of space) expect(rem(entry.value)).toBe(Number(entry.tailwind) * 4);
    // Tier-1 names keep their D16 values (plugin styles read them).
    expect(tokens.space['space-5'].value).toBe('1.5rem');
    expect(tokens.space['space-6'].value).toBe('2rem');
    const radii = Object.fromEntries(Object.entries(tokens.radius as Record<string, string>).map(([name, value]) => [name, rem(value)]));
    expect(radii).toEqual({ 'r-0': 0, 'r-1': 6, 'r-2': 10, 'r-3': 14, 'r-4': 18, 'r-5': 20, 'r-6': 24, 'r-7': 28, 'r-full': 9999 });
    expect(Object.values(tokens.controlSize as Record<string, string>).map(rem)).toEqual([36, 40, 48, 44, 46, 28, 32, 40, 48, 20]);
    expect(tokens.breakpoints).toEqual({ sm: '40rem', md: '48rem', lg: '64rem', xl: '90rem' });
    expect(tokens.contentWidth).toEqual({ reading: '60rem', data: '80rem' });
  });

  it('semantic values follow the soft-card spacing table (D36, amends D16 「按尺寸取值」)', () => {
    const at = (name: string) => tokens.semantic[name];
    const px = (name: string, size: 'base' | 'sm' | 'lg') => {
      const value = String(at(name)[size]);
      return value in tokens.space ? rem(tokens.space[value].value) : value in tokens.radius ? rem(tokens.radius[value]) : rem(value);
    };
    // Page margins 16 on phones, 32 on the web; cards 12 apart on phones, 20–24 on the web.
    expect([px('page-padding-inline', 'base'), px('page-padding-inline', 'lg')]).toEqual([16, 32]);
    expect([px('section-gap', 'base'), px('section-gap', 'sm'), px('section-gap', 'lg')]).toEqual([12, 20, 24]);
    // Card padding 16–20 on phones, 24 on the web; caption to card 8.
    expect([px('card-padding', 'base'), px('card-padding', 'sm'), px('card-padding', 'lg')]).toEqual([16, 20, 24]);
    expect(px('stack-gap', 'base')).toBe(8);
    // Cards: radius 24 on phones, 28 on the web, no border, shadow-sm.
    expect([px('card-radius', 'base'), px('card-radius', 'lg')]).toEqual([24, 28]);
    expect(at('card-border')).toMatchObject({ base: '0px', sm: '0px', lg: '0px' });
    expect(at('card-elevation')).toMatchObject({ base: 'e-1', sm: 'e-1', lg: 'e-1' });
    // Rows 56 on phones, 52 on the web; controls 48 / 40 / 36; fields radius 14, buttons pills.
    expect([px('list-row-height', 'base'), px('list-row-height', 'lg')]).toEqual([56, 52]);
    expect(['base', 'sm', 'lg'].map((size) => px('control-height', size as 'base'))).toEqual([48, 48, 48]);
    expect(px('control-height-medium', 'lg')).toBe(40);
    expect(px('control-height-compact', 'lg')).toBe(36);
    expect(px('control-height-compact', 'base')).toBe(44);
    expect(px('control-radius', 'lg')).toBe(14);
    expect(at('pill-radius').lg).toBe('r-full');
    // Menus 20 with 46px items (14); dialogs, sheets and drawers 28; menus and dialogs shadow-lg.
    expect([px('popover-radius', 'lg'), px('popover-item-radius', 'lg'), px('popover-item-height', 'lg')]).toEqual([20, 14, 46]);
    expect([px('dialog-radius', 'lg'), px('sheet-radius', 'lg')]).toEqual([28, 28]);
    expect(at('popover-radius').base).toBe('r-7 r-7 r-0 r-0');
    expect(at('popover-elevation')).toMatchObject({ base: 'e-3', sm: 'e-3', lg: 'e-3' });
    expect(at('float-elevation').lg).toBe('e-2');
    expect(resolveSemanticValue('clamp(space-4, 2.5vw, space-6)')).toBe('clamp(var(--console-space-4), 2.5vw, var(--console-space-6))');
    expect(resolveSemanticValue('space-4-5 space-6-5')).toBe('var(--console-space-4-5) var(--console-space-6-5)');
  });

  it('group spacing ≤ card padding at every width; cards are at least a group gap apart (D18 第 2 条, amended by D36)', () => {
    const value = (name: string, size: 'base' | 'sm' | 'lg') => rem(tokens.space[tokens.semantic[name][size]].value);
    for (const size of ['base', 'sm', 'lg'] as const) {
      expect(value('stack-gap', size)).toBeLessThanOrEqual(value('card-padding', size));
      expect(value('stack-gap', size)).toBeLessThanOrEqual(value('section-gap', size));
    }
    // From 40rem the section gap is at least the card padding again (20–24 between web cards).
    for (const size of ['sm', 'lg'] as const) expect(value('card-padding', size)).toBeLessThanOrEqual(value('section-gap', size));
  });

  it('nested radii: inner ≤ outer − padding (D16 配套规则); segments are pills inside a pill', () => {
    const radius = (name: string) => rem(tokens.radius[name]);
    const space = (name: string) => rem(tokens.space[name].value);
    for (const size of ['base', 'sm', 'lg'] as const) {
      const outer = radius(String(tokens.semantic['popover-radius'][size]).split(' ')[0]);
      const inner = radius(tokens.semantic['popover-item-radius'][size]);
      expect(inner).toBeLessThanOrEqual(Math.max(0, outer - space(tokens.semantic['popover-padding'][size])));
    }
    expect(tokens.semantic['segment-radius'].lg).toBe('r-full');
  });

  it('the Tailwind theme only offers on-scale keys and keeps sizing separate', () => {
    const theme = themeCss();
    for (const reset of ['--spacing: initial;', '--spacing-*: initial;', '--text-*: initial;', '--radius-*: initial;', '--shadow-*: initial;', '--breakpoint-*: initial;']) {
      expect(theme).toContain(reset);
    }
    const spacing = [...theme.matchAll(/--spacing-([\w.\\]+):/gu)].map((match) => match[1]);
    expect(spacing).toEqual(['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16']);
    expect(theme).toContain('--height-11: 2.75rem;');
    expect(theme).toContain('--radius-control: var(--console-control-radius);');
    expect(theme).toContain('--radius-pill: var(--console-pill-radius);');
    expect(theme).toContain('--shadow-e2: var(--console-elevation-2);');
    expect(theme).toContain('--shadow-hairline: var(--console-hairline-ring);');
    expect(theme).toContain('--text-title: var(--console-text-title);');
    expect(theme).toContain('--text-label: var(--console-text-label);');
    // Soft-card colours; the shadcn names that already exist keep their meaning.
    for (const name of ['surface', 'sunken', 'raised', 'ink', 'faint', 'tint-2', 'accent-2', 'ok-bg', 'danger-solid', 'primary-soft', 'on-primary', 'inverse']) {
      expect(theme).toContain(`--color-${name}: hsl(var(--console-${name}));`);
    }
    expect(theme).not.toContain('--color-bg:');
    expect(theme).toContain('--color-muted: hsl(var(--muted));');
    expect(theme).toContain('@custom-variant dark {');
    expect(buildScale().tailwind.spacingKeys).toEqual(['0', 'px', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16']);
  });

  it('motion (soft cards D37): fast / base / slow (enter) / exit / pulse and their curves; the old duration names were removed in P4', () => {
    expect(tokens.motion).toEqual({ 'motion-fast': '120ms', 'motion-base': '200ms', 'motion-slow': '280ms', 'motion-exit': '180ms', 'motion-pulse': '1600ms' });
    expect(tokens.misc['ease-out']).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(tokens.misc['ease-fast']).toBe('ease-out');
    expect(tokens.misc['ease-exit']).toBe('cubic-bezier(0.3, 0, 1, 1)');
    expect(tokens.removedAliases).toMatchObject({ 'duration-fast': 'motion-fast', 'duration-page': 'motion-base' });
    expect(tokensCss()).not.toMatch(/--console-duration-/u);
    const theme = themeCss();
    expect(theme).toContain('--default-transition-duration: var(--console-motion-fast);');
    expect(theme).toContain('--default-transition-timing-function: var(--console-ease-out);');
    expect(theme).toContain('--color-brand: hsl(var(--console-brand));');
    expect(theme).toContain('--color-signal-warning-fill: hsl(var(--console-signal-warning-fill));');
    expect(tokens.composite['focus-ring']).toBe('var(--console-focus-ring-width) solid hsl(var(--console-focus))');
  });

  it('publishes the scale for the linters, plugin check and the audit', () => {
    const json = JSON.parse(readFileSync(join(packageRoot, 'client/styles/generated/scale.json'), 'utf8'));
    expect(json).toEqual(JSON.parse(JSON.stringify(buildScale())));
    expect(json.css.customMedia['--console-sm']).toBe('(min-width: 40rem)');
  });
});

describe('components (ADR 0063 D15, D18)', () => {
  it('StatusBadge is a dot and a word (soft cards D39); old status names map onto the five tones', () => {
    expect(isAttentionStatus('ok')).toBe(false);
    expect(isAttentionStatus('neutral')).toBe(false);
    expect(isAttentionStatus('error')).toBe(true);
    expect(isAttentionStatus('progress')).toBe(true);
    const ok = renderToStaticMarkup(h(StatusBadge, { status: 'ok' }, '正常'));
    expect(ok).toBe('<span class="console-status" data-slot="status" data-status="ok" data-tone="ok">正常</span>');
    expect(ok).not.toContain('console-badge');
    for (const [status, tone] of [['warning', 'warn'], ['error', 'danger'], ['info', 'progress'], ['pending', 'progress'], ['neutral', 'neutral'], ['danger', 'danger']] as const) {
      expect(renderToStaticMarkup(h(StatusBadge, { status }, 'x')), status).toContain(`data-tone="${tone}"`);
    }
    // Badges are light pills on the state's -bg.
    expect(renderToStaticMarkup(h(Badge, { variant: 'success' }, '已启用'))).toContain('data-variant="success" class="console-badge console-badge-success"');
    expect(renderToStaticMarkup(h(Badge, { variant: 'warning' }, '可更新'))).toContain('console-badge-warning');
    expect(renderToStaticMarkup(h(Badge, null, 'v1.4.2'))).toContain('console-badge-neutral');
    expect(renderToStaticMarkup(h(Badge, { tone: 2 }, '插件'))).toContain('data-tone="2"');
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

describe('themes (D38)', () => {
  /** Compiles utilities the way a Tailwind consumer (the Console) does: on top of the generated theme. */
  async function compileUtilities(candidates: string[]) {
    const { compile } = await import('tailwindcss');
    const require = createRequire(join(packageRoot, 'package.json'));
    const input = '@import "tailwindcss/theme.css" layer(theme);\n@import "./client/styles/generated/theme.css";\n@import "tailwindcss/utilities.css" layer(utilities);\n';
    const compiler = await compile(input, {
      base: packageRoot,
      async loadStylesheet(id: string, base: string) {
        const path = id.startsWith('tailwindcss/') ? require.resolve(id) : join(base, id);
        return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
      },
    });
    return compiler.build(candidates);
  }

  it('without any theme the page is light; dark is .dark / [data-theme="dark"]; the system preference only with data-theme="system"', () => {
    const css = tokensCss();
    // Light values on every theme root, :root included — nothing turns a bare root dark.
    expect(css).toMatch(/:root, \.light, \.dark, \[data-theme="light"\], \[data-theme="dark"\], \[data-theme="system"\] \{\n {4}color-scheme: light;/u);
    expect(css).toMatch(/\n {2}\.dark, \[data-theme="dark"\] \{\n {4}color-scheme: dark;/u);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {4}\[data-theme="system"\] \{\n {6}color-scheme: dark;/u);
    expect(css).not.toMatch(/:root:not\(/u);
  });

  it('dark: applies inside .dark, [data-theme="dark"] and (system dark) [data-theme="system"], never inside a .light island; zero specificity', async () => {
    const theme = themeCss();
    expect(theme).toContain('&:where(.dark, .dark *, [data-theme="dark"], [data-theme="dark"] *):not(:where(.light, .light *, [data-theme="light"], [data-theme="light"] *)) {');
    expect(theme).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {4}&:where\(\[data-theme="system"\], \[data-theme="system"\] \*\):not\(:where\(\.light, \.light \*, \[data-theme="light"\], \[data-theme="light"\] \*\)\) \{/u);
    expect(theme).not.toContain(':root:not(');
    const css = await compileUtilities(['dark:bg-danger']);
    expect(css).toContain('.dark\\:bg-danger:where(.dark, .dark *, [data-theme="dark"], [data-theme="dark"] *):not(:where(.light, .light *, [data-theme="light"], [data-theme="light"] *))');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*\.dark\\:bg-danger:where\(\[data-theme="system"\], \[data-theme="system"\] \*\):not\(:where\(\.light/u);
  });
});
