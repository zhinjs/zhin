/**
 * Colour checks of the soft-card palette (ADR 0063 D34, the kit's §10 contrast table): text ≥ 4.5:1,
 * icons and controls ≥ 3:1, in both themes; category colours only draw shapes; no blue or purple;
 * chart colours stay apart. Values come from tokens/tokens.mjs (the only source).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain ESM modules without declarations
import * as tokens from '../tokens/tokens.mjs';
// @ts-expect-error — plain ESM modules without declarations
import { contrast, deltaE2000, parseColor } from '../tokens/color.mjs';
// @ts-expect-error — plain ESM modules without declarations
import { hslTriplet } from '../tokens/scale.mjs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs, TabsList, TabsTrigger } from '../client/components/ui/tabs.js';

type Rgb = [number, number, number];
type Theme = 'light' | 'dark';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const colorsCss = readFileSync(join(packageRoot, 'tokens/colors.css'), 'utf8');
const palette = tokens.palette as Record<Theme, Record<string, string>>;
const roles = tokens.color as Record<Theme, Record<string, string>>;
const paint = tokens.paint as Record<Theme, Record<string, string>>;
const THEMES = ['light', 'dark'] as const;

const c = (theme: Theme, name: string): Rgb => parseColor(palette[theme][name] ?? roles[theme][name]) as Rgb;
const stops = (gradient: string): Rgb[] => [...gradient.matchAll(/#[0-9a-f]{6}/giu)].map((match) => parseColor(match[0]) as Rgb);
const ratio = (theme: Theme, fg: string, bg: string) => contrast(c(theme, fg), c(theme, bg));

/** sRGB → HSL hue and saturation (for the no-blue / no-purple rule). */
function hueSaturation([r, g, b]: Rgb): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0];
  const s = d / (1 - Math.abs(2 * l - 1));
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue *= 60;
  return [hue < 0 ? hue + 360 : hue, s];
}

describe('soft-card palette (D34)', () => {
  it('both themes define the same names; values are literal colours', () => {
    expect(Object.keys(palette.dark)).toEqual(Object.keys(palette.light));
    expect(Object.keys(roles.dark).sort()).toEqual(Object.keys(roles.light).sort());
    expect(Object.keys(paint.dark)).toEqual(Object.keys(paint.light));
    for (const theme of THEMES) {
      for (const value of [...Object.values(palette[theme]), ...Object.values(roles[theme])]) expect(value).not.toMatch(/var\(/u);
    }
  });

  it('matches the kit: primary is black / white, progress is accent-1', () => {
    expect(palette.light.primary).toBe(palette.light.ink);
    expect(palette.dark.primary).toBe(palette.dark.ink);
    expect(palette.light['on-primary']).toBe('#FFFFFF');
    for (const theme of THEMES) expect(palette[theme].progress).toBe(palette[theme]['accent-1']);
    expect(palette.light.bg).toBe('#F7F5F3');
    expect(palette.dark.surface).toBe('#1C1918');
  });

  it('the generator writes hex as HSL triplets that round-trip', () => {
    for (const theme of THEMES) {
      for (const [name, value] of Object.entries(palette[theme])) {
        expect(deltaE2000(parseColor(hslTriplet(value)), parseColor(value)), `${theme} ${name}`).toBeLessThan(0.5);
      }
    }
  });

  it('no blue or purple anywhere (hue 200°–300° with any saturation)', () => {
    for (const theme of THEMES) {
      const values = [...Object.entries(palette[theme]), ...Object.entries(roles[theme]).filter(([name]) => !name.startsWith('brand'))];
      for (const [name, value] of values) {
        const [hue, saturation] = hueSaturation(parseColor(value) as Rgb);
        if (saturation < 0.12) continue;
        expect(hue >= 200 && hue <= 300, `${theme} ${name} ${value} hue ${Math.round(hue)}`).toBe(false);
      }
    }
  });

  it('colors.css maps the shadcn names onto the palette and no longer has palettes', () => {
    expect(colorsCss).not.toMatch(/:root\[data-palette=/u);
    for (const [name, target] of [['--background', 'bg'], ['--foreground', 'ink'], ['--card', 'surface'], ['--popover', 'raised'], ['--primary', 'primary'], ['--primary-foreground', 'on-primary'], ['--muted-foreground', 'muted'], ['--border', 'line'], ['--input', 'control'], ['--ring', 'focus'], ['--destructive', 'danger']]) {
      expect(colorsCss, name).toContain(`${name}: var(--console-${target});`);
    }
  });
});

describe.each(THEMES)('%s theme: contrast (kit §10)', (theme) => {
  const text = (fg: string, bg: string) => expect(ratio(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  const shape = (fg: string, bg: string) => expect(ratio(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);

  it('ink and muted on every surface, tint, hero and aurora; faint on the surface', () => {
    for (const surface of ['surface', 'bg', 'sunken', 'raised', 'primary-soft', 'tint-1', 'tint-2', 'tint-3', 'tint-4', 'tint-5']) {
      text('ink', surface);
      text('muted', surface);
    }
    const backgrounds = [...stops(paint[theme]['gradient-hero']), ...stops(paint[theme]['gradient-hero-2'])];
    for (const name of ['aurora-1', 'aurora-2', 'aurora-3', 'aurora-4']) {
      // The aurora is laid over bg at its opacity.
      const blob = parseColor(paint[theme][name]) as Rgb;
      const alpha = Number(paint[theme]['aurora-opacity']);
      backgrounds.push(blob.map((channel, index) => channel * alpha + c(theme, 'bg')[index] * (1 - alpha)) as Rgb);
    }
    for (const background of backgrounds) {
      expect(contrast(c(theme, 'ink'), background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c(theme, 'muted'), background)).toBeGreaterThanOrEqual(4.5);
    }
    text('faint', 'surface');
    text('faint', 'bg');
  });

  it('on-primary on primary, on-inverse on inverse, white on danger-solid', () => {
    text('on-primary', 'primary');
    text('on-primary', 'primary-hover');
    text('on-inverse', 'inverse');
    text('on-danger-solid', 'danger-solid');
  });

  it('states: ok / warn / danger on the surfaces and on their own -bg', () => {
    for (const state of ['ok', 'warn', 'danger']) {
      text(state, 'surface');
      text(state, 'bg');
      text(state, 'raised');
      text(state, `${state}-bg`);
    }
  });

  it('category colours (icons only): accent on its tint and on the surface ≥ 3:1', () => {
    for (let index = 1; index <= 5; index += 1) {
      shape(`accent-${index}`, `tint-${index}`);
      shape(`accent-${index}`, 'surface');
    }
    shape('progress', 'surface');
    shape('progress', 'sunken');
  });

  it('controls and the focus ring ≥ 3:1', () => {
    shape('control', 'surface');
    shape('control', 'bg');
    shape('focus', 'surface');
    shape('focus', 'bg');
    // The off switch track under its white thumb.
    shape('surface', 'control');
  });

  it('legacy roles: signal text on surfaces, destructive-foreground on destructive', () => {
    for (const signal of ['danger', 'warning', 'success', 'info']) {
      expect(contrast(c(theme, `signal-${signal}-text`), c(theme, 'surface')), signal).toBeGreaterThanOrEqual(4.5);
    }
    const destructiveForeground = theme === 'dark' ? c(theme, 'on-primary') : c(theme, 'on-danger-solid');
    expect(contrast(destructiveForeground, c(theme, 'danger'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('inactive tabs use --tab-inactive', () => {
  it('TabsList writes text-tab-inactive (not muted-foreground); the theme maps it to --tab-inactive (muted on sunken ≥ 4.5)', () => {
    const markup = renderToStaticMarkup(h(Tabs, { defaultValue: 'a' }, h(TabsList, null, h(TabsTrigger, { value: 'a' }, 'A'), h(TabsTrigger, { value: 'b' }, 'B'))));
    const list = markup.match(/<div[^>]*role="tablist"[^>]*>/u)?.[0] ?? '';
    expect(list).toContain('text-tab-inactive');
    expect(list).toContain('console-segmented');
    expect(list).not.toContain('text-muted-foreground');
    const theme = readFileSync(join(packageRoot, 'client/styles/generated/theme.css'), 'utf8');
    expect(theme).toContain('--color-tab-inactive: hsl(var(--tab-inactive));');
    for (const mode of THEMES) expect(ratio(mode, 'muted', 'sunken')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('chart colours', () => {
  for (const theme of THEMES) {
    const charts = Array.from({ length: 8 }, (_, index) => c(theme, `chart-${index + 1}`));

    it(`${theme}: the five accents are chart-1, -3, -4, -6, -8; neighbours differ by ΔE2000 ≥ 20, every pair by ≥ 12`, () => {
      expect(new Set([1, 3, 4, 6, 8].map((n) => roles[theme][`chart-${n}`]))).toEqual(new Set([1, 2, 3, 4, 5].map((n) => palette[theme][`accent-${n}`])));
      for (let index = 0; index < charts.length - 1; index += 1) {
        expect(deltaE2000(charts[index], charts[index + 1]), `chart-${index + 1} / chart-${index + 2}`).toBeGreaterThanOrEqual(20);
      }
      for (let a = 0; a < charts.length; a += 1) {
        for (let b = a + 1; b < charts.length; b += 1) {
          expect(deltaE2000(charts[a], charts[b]), `chart-${a + 1} / chart-${b + 1}`).toBeGreaterThanOrEqual(12);
        }
      }
    });

    it(`${theme}: every chart colour ≥ 3:1 on the card (marks, not text)`, () => {
      charts.forEach((chart, index) => expect(contrast(chart, c(theme, 'surface')), `chart-${index + 1}`).toBeGreaterThanOrEqual(3));
      expect(contrast(c(theme, 'chart-other'), c(theme, 'surface'))).toBeGreaterThanOrEqual(3);
    });
  }
});
