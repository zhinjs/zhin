/**
 * Color roles (ADR 0063 「色板角色与信号色」, zhinjs/console#125): contrast of brand, the primary
 * button and the signal text colors, and the distance between chart colors, under every palette
 * in both themes. Palette colors are resolved from tokens/colors.css the way the browser would.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain ESM modules without declarations
import * as tokens from '../tokens/tokens.mjs';
// @ts-expect-error — plain ESM modules without declarations
import { contrast, deltaE2000, lightness, over, parseColor } from '../tokens/color.mjs';

type Rgb = [number, number, number];
type Theme = 'light' | 'dark';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const colorsCss = readFileSync(join(packageRoot, 'tokens/colors.css'), 'utf8');
const roles = tokens.color as Record<Theme, Record<string, string>>;

function block(selector: string): Record<string, string> {
  const start = colorsCss.indexOf(`${selector} {`);
  if (start < 0) return {};
  const body = colorsCss.slice(start + selector.length + 2, colorsCss.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2].trim()]));
}

const PALETTES = [...colorsCss.matchAll(/:root\[data-palette="([a-z]+)"\]/gu)].map((match) => match[1]);

/** All custom properties of the root element for a palette and theme, with var() resolved. */
function environment(palette: string, theme: Theme) {
  const declared: Record<string, string> = {
    ...block(':root'),
    ...block(`:root[data-palette="${palette}"]`),
    ...(theme === 'dark' ? block('.dark') : {}),
  };
  for (const [name, value] of Object.entries(roles[theme])) declared[`--console-${name}`] = value;
  const resolve = (value: string, depth = 0): string => {
    if (depth > 20) throw new Error(`var() cycle in ${value}`);
    return value.replace(/var\((--[a-z0-9-]+)\)/gu, (_, name: string) => {
      if (!(name in declared)) throw new Error(`${name} is not defined (${palette}, ${theme})`);
      return resolve(declared[name], depth + 1);
    });
  };
  return (name: string): Rgb => parseColor(resolve(declared[name] ?? `var(${name})`)) as Rgb;
}

const role = (theme: Theme, name: string): Rgb => parseColor(roles[theme][name]) as Rgb;
const hsl = (value: string) => value.split(/\s+/u).map((part) => Number.parseFloat(part));
const SIGNALS = ['danger', 'warning', 'success', 'info'] as const;
const CASES = PALETTES.flatMap((palette) => (['light', 'dark'] as const).map((theme) => [palette, theme] as const));

describe('color roles do not follow the palette', () => {
  it('8 palettes; none overrides a role token', () => {
    expect(PALETTES).toHaveLength(8);
    for (const palette of PALETTES) {
      expect(Object.keys(block(`:root[data-palette="${palette}"]`)).filter((name) => name.startsWith('--console-'))).toEqual([]);
    }
    for (const theme of ['light', 'dark'] as const) {
      for (const value of Object.values(roles[theme])) expect(value).not.toMatch(/var\(/u);
    }
    expect(Object.keys(roles.dark).sort()).toEqual(Object.keys(roles.light).sort());
  });

  it('brand is #76EEC6 (light) / #7FFFD4 (dark), owner 2026-11-16; brand-text shares its hue', () => {
    expect(deltaE2000(role('light', 'brand'), parseColor('#76EEC6'))).toBeLessThan(1);
    expect(deltaE2000(role('dark', 'brand'), parseColor('#7FFFD4'))).toBeLessThan(1);
    expect(roles.dark['brand-text']).toBe(roles.dark.brand);
    for (const theme of ['light', 'dark'] as const) {
      expect(Math.abs(hsl(roles[theme]['brand-text'])[0] - 160), theme).toBeLessThanOrEqual(1);
    }
  });

  it('signal fill and text keep hue and saturation across themes; only lightness changes', () => {
    for (const signal of SIGNALS) {
      const names = [`signal-${signal}-fill`, `signal-${signal}-text`];
      const [hue, saturation] = hsl(roles.light[names[0]]);
      for (const theme of ['light', 'dark'] as const) {
        for (const name of names) expect(hsl(roles[theme][name]).slice(0, 2), `${theme} ${name}`).toEqual([hue, saturation]);
      }
    }
    // Amber, bright: the fill is no longer the brown text color (zhinjs/console#125 §3).
    expect(hsl(roles.light['signal-warning-fill'])).toEqual([38, 92, 50]);
  });
});

describe.each(CASES)('%s palette, %s theme', (palette, theme) => {
  const color = environment(palette, theme);
  const surfaces = { card: color('--card'), background: color('--background'), popover: color('--popover') };

  it('inactive tab labels ≥ 4.5:1 on the tab list fill (background or card + 6% foreground)', () => {
    for (const [name, surface] of [['background', surfaces.background], ['card', surfaces.card]] as const) {
      const fill = over(color('--foreground'), 0.06, surface);
      expect(contrast(color('--tab-inactive'), fill), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary button: brand-foreground on brand ≥ 4.5:1; background lightness apart from every other button', () => {
    const brand = color('--console-brand');
    expect(contrast(brand, color('--console-brand-foreground'))).toBeGreaterThanOrEqual(4.5);
    const others = {
      soft: color('--primary-action'),
      outline: surfaces.card,
      secondary: color('--secondary'),
      ghost: surfaces.card,
      'destructive (ghost)': surfaces.card,
    };
    // Dark theme: ≥ 30 (CIE L*). Light theme: the owner's #76EEC6 is itself light (L* 86.6), so a
    // solid mint button on white is only ~13 apart; the primary button gets a brand-text hairline
    // instead (≥ 3:1 boundary, see below). Measured values are listed in ADR 0063.
    const minimum = theme === 'dark' ? 30 : 5;
    for (const [name, background] of Object.entries(others)) {
      expect(Math.abs(lightness(brand) - lightness(background)), name).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('light theme: the primary button outline (brand-text) is ≥ 3:1 on the card', () => {
    if (theme === 'dark') return;
    expect(contrast(over(color('--console-brand-text'), PRIMARY_BORDER_ALPHA, surfaces.card), surfaces.card)).toBeGreaterThanOrEqual(3);
  });

  it('brand-text (links, focus ring, selection) ≥ 4.5:1 on every surface', () => {
    const brand = color('--console-brand-text');
    for (const [name, surface] of Object.entries(surfaces)) {
      expect(contrast(brand, surface), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('signal text ≥ 4.5:1 on surfaces and on its own badge tint', () => {
    for (const signal of SIGNALS) {
      const text = color(`--console-signal-${signal}-text`);
      const fill = color(`--console-signal-${signal}-fill`);
      for (const [name, surface] of Object.entries(surfaces)) {
        expect(contrast(text, surface), `${signal} on ${name}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text, over(fill, BADGE_TINT, surface)), `${signal} on its badge (${name})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('destructive-solid (confirm dialogs only): foreground on destructive ≥ 4.5:1', () => {
    expect(contrast(color('--destructive'), color('--destructive-foreground'))).toBeGreaterThanOrEqual(4.5);
  });
});

/** Alpha of the brand-text outline of the primary button (button.tsx `border-brand-text/…`). */
const PRIMARY_BORDER_ALPHA = 0.7;

/** Alpha of the signal fill under a badge (components.css `.console-badge-*`). */
const BADGE_TINT = 0.12;

describe('chart colors', () => {
  for (const theme of ['light', 'dark'] as const) {
    const charts = Array.from({ length: 8 }, (_, index) => role(theme, `chart-${index + 1}`));

    it(`${theme}: neighbours differ by ΔE2000 ≥ 20, every pair by ≥ 12`, () => {
      for (let index = 0; index < charts.length - 1; index += 1) {
        expect(deltaE2000(charts[index], charts[index + 1]), `chart-${index + 1} / chart-${index + 2}`).toBeGreaterThanOrEqual(20);
      }
      for (let a = 0; a < charts.length; a += 1) {
        for (let b = a + 1; b < charts.length; b += 1) {
          expect(deltaE2000(charts[a], charts[b]), `chart-${a + 1} / chart-${b + 1}`).toBeGreaterThanOrEqual(12);
        }
      }
    });

    it(`${theme}: every chart color ≥ 3:1 on the card (marks, not text)`, () => {
      for (const palette of PALETTES) {
        const card = environment(palette, theme)('--card');
        charts.forEach((chart, index) => expect(contrast(chart, card), `${palette} chart-${index + 1}`).toBeGreaterThanOrEqual(3));
      }
    });
  }
});
