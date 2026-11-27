/**
 * @zhin.js/console-ui design tokens — the single source of truth (ADR 0063 D16, D17).
 *
 * Everything that sizes the Console is defined here once and only here. `tokens/generate.mjs`
 * turns it into the files that consumers read; none of them may be edited by hand:
 *   - client/styles/generated/tokens.css        three tiers of CSS variables + the by-size rules
 *   - client/styles/generated/theme.css         Tailwind 4 `@theme` (only the on-scale keys)
 *   - client/styles/generated/custom-media.css  `@custom-media --console-<bp>` for the shell
 *   - client/styles/generated/scale.json        allowed values for stylelint, ESLint,
 *                                               `zhin plugin check` and the Playwright audit
 *
 * Tiers:
 *   1. base scale   — the only values the Console uses (type, weight, space-1…8, r-0…4/full,
 *                     hairline/focus, e-0…3, breakpoints, content widths)
 *   2. semantic     — what components read (`--console-card-padding`, …); components and Console
 *                     pages never read tier 1 directly, let alone write numbers
 *   3. by size      — the value of each semantic token per width (D16 「按尺寸取值」 table):
 *                     page-level tokens follow the viewport, every other token follows the width of
 *                     the container the component sits in (D18)
 *
 * Colors: the soft-card palette (`palette`, `paint`, ADR 0063 增补「柔光卡片」D34–D41) and the
 * colour roles (`color`) are defined here; tokens/colors.css only maps the shadcn-style names the
 * Console and plugin pages already use (`--background`, `--primary`, …) onto them.
 *
 * Themes (D38): light on `:root` / `.light` / `[data-theme="light"]` (and without any theme); dark on
 * `.dark` / `[data-theme="dark"]`; `[data-theme="system"]` opts in to `prefers-color-scheme`.
 */

/** Breakpoints (D16). Media queries are for the global shell only; components use containers. */
export const breakpoints = {
  sm: '40rem',
  md: '48rem',
  lg: '64rem',
  xl: '90rem',
};

/**
 * Type scale (soft cards, ADR 0063 D35 — replaces the five-size limit of D16): eight sizes with
 * their line heights. `display` is for stat values, `title` for page titles.
 *   xs 12/16 group captions, table headers, tab bar · sm 13/18 descriptions, times, units
 *   md 14/20 web body, tables · lg 15/22 phone body, list titles, buttons
 *   xl 17/24 card / dialog titles · 2xl 22/30 hero card titles · title 26/34 · display 32/40
 */
export const text = {
  xs: { size: '0.75rem', leading: '1rem' },
  sm: { size: '0.8125rem', leading: '1.125rem' },
  md: { size: '0.875rem', leading: '1.25rem' },
  lg: { size: '0.9375rem', leading: '1.375rem' },
  xl: { size: '1.0625rem', leading: '1.5rem' },
  '2xl': { size: '1.375rem', leading: '1.875rem' },
  title: { size: '1.625rem', leading: '2.125rem' },
  display: { size: '2rem', leading: '2.5rem' },
};

/**
 * The type names of ADR 0063 D16 (`--console-text-label`, `text-body`, …) stay: each now names one
 * of the eight sizes above (`title` and `display` are themselves sizes of the new scale).
 */
export const textAliases = {
  label: 'sm',
  body: 'md',
  section: 'xl',
};

/** Font weights: at most 3 (D16). */
export const weight = {
  regular: '400',
  medium: '500',
  strong: '600',
};

/**
 * Spacing on the 4px grid (D16, soft cards D36: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48).
 * `tailwind` is the Tailwind key with the same value (D17): the tier-1 names keep their D16 values
 * (space-5 is 24px = `p-6`), the two steps added for soft cards sit between them (`space-4-5` 20px
 * = `p-5`, `space-6-5` 40px = `p-10`). 64px (`space-8`) stays for compatibility.
 */
export const space = {
  'space-1': { value: '0.25rem', tailwind: '1' },
  'space-2': { value: '0.5rem', tailwind: '2' },
  'space-3': { value: '0.75rem', tailwind: '3' },
  'space-4': { value: '1rem', tailwind: '4' },
  'space-4-5': { value: '1.25rem', tailwind: '5' },
  'space-5': { value: '1.5rem', tailwind: '6' },
  'space-6': { value: '2rem', tailwind: '8' },
  'space-6-5': { value: '2.5rem', tailwind: '10' },
  'space-7': { value: '3rem', tailwind: '12' },
  'space-8': { value: '4rem', tailwind: '16' },
};

/**
 * Radii (D16, soft cards D36). Soft-card names: sm 10 = r-2, md 14 = r-3 (inputs, menu items),
 * lg 18 = r-4 (sub cards), menu 20 = r-5, xl 24 = r-6 (phone cards, action bar, hero), 2xl 28 = r-7
 * (web cards, dialogs, drawers), pill = r-full (buttons, chips, segments, switches, tiles). r-1
 * (6px) stays for checkboxes and existing plugin styles. Nested: outer = inner + padding.
 */
export const radius = {
  'r-0': '0rem',
  'r-1': '0.375rem',
  'r-2': '0.625rem',
  'r-3': '0.875rem',
  'r-4': '1.125rem',
  'r-5': '1.25rem',
  'r-6': '1.5rem',
  'r-7': '1.75rem',
  'r-full': '9999px',
};

/** Borders (D16): hairline for every divider and outline, focus only for focus rings. */
export const border = {
  hairline: '1px',
  // Checkbox and radio rings (soft cards, CForms): 1.5px.
  check: '1.5px',
  focus: '2px',
};

/**
 * Elevation (D16, soft cards D36): e-0 none; e-1 = shadow-sm (white cards, round buttons); e-2 =
 * shadow-md (tab bar, action bar, toasts); e-3 = shadow-lg (popovers, menus, dialogs, drawers).
 * Light theme: warm drops. Dark theme: shadows do not read, so a 1px white inner ring plus a top
 * highlight (e-1) or the ring plus a black drop (e-2, e-3).
 */
export const elevation = {
  light: {
    'e-0': 'none',
    'e-1': '0 1px 2px rgb(80 40 20 / 0.04), 0 8px 24px -12px rgb(80 40 20 / 0.12)',
    'e-2': '0 12px 32px -12px rgb(80 40 20 / 0.22)',
    'e-3': '0 24px 64px -16px rgb(80 40 20 / 0.32)',
  },
  dark: {
    'e-0': 'none',
    'e-1': 'inset 0 0 0 1px rgb(255 255 255 / 0.06), inset 0 1px 0 rgb(255 255 255 / 0.05)',
    'e-2': 'inset 0 0 0 1px rgb(255 255 255 / 0.07), 0 8px 24px rgb(0 0 0 / 0.5)',
    'e-3': 'inset 0 0 0 1px rgb(255 255 255 / 0.08), 0 24px 64px rgb(0 0 0 / 0.6)',
  },
};

/**
 * Content widths (D16, D18): reading / form pages and data pages. Soft cards (D36): the web
 * content is at most 1280px (`data` 80rem).
 */
export const contentWidth = {
  reading: '60rem',
  data: '80rem',
};

/**
 * Control sizes (soft cards D36, tokens.json `control`): 36 / 40 / 48 controls, the 44 round icon
 * button, the 46 × 28 switch and the 32 / 40 / 48 icon tiles.
 */
export const controlSize = {
  'control-sm': '2.25rem',
  'control-md': '2.5rem',
  'control-lg': '3rem',
  'icon-button': '2.75rem',
  'switch-width': '2.875rem',
  'switch-height': '1.75rem',
  'tile-sm': '2rem',
  'tile-md': '2.5rem',
  'tile-lg': '3rem',
  icon: '1.25rem',
};

/** Minimum touch target on phone-sized containers (D18): 44 × 44 px. */
export const touchTarget = '2.75rem';

/**
 * Other base-tier tokens that are not part of the size scale (fonts, line heights for code,
 * the easing curve, derived surfaces). Unchanged from P1a except the durations, which moved to
 * {@link motion}.
 */
export const misc = {
  // Font stacks (ADR 0063 D33): Inter / JetBrains Mono first, then system faces. The package ships
  // no font files — the host (the Console) loads Inter and JetBrains Mono with @font-face.
  // Soft cards (D35): system faces first, then the CJK faces; Inter stays as the first choice when
  // the host loads it.
  'font-sans': "'Inter', system-ui, -apple-system, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  'font-mono': "'JetBrains Mono', 'SF Mono', 'Cascadia Code', ui-monospace, Menlo, Consolas, 'Noto Sans Mono CJK SC', monospace",
  'line-code': '1.25rem',
  'leading-code': '1.6',
  'shadow-color': '20 60% 20%',
  // Easing (soft cards D37): `ease-out` is the standard curve of base / enter motion (switches,
  // segments, overlays entering); `ease-fast` for hover, press and colour; `ease-exit` for leaving.
  'ease-out': 'cubic-bezier(0.2, 0, 0, 1)',
  'ease-fast': 'ease-out',
  'ease-exit': 'cubic-bezier(0.3, 0, 1, 1)',
  'surface-raised': 'hsl(var(--card))',
  'surface-muted': 'hsl(var(--secondary))',
  'surface-inset': 'hsl(var(--secondary))',
  // Hover and press overlays (D37): 4 % and 8 % ink.
  'surface-hover': 'hsl(var(--console-ink) / 0.04)',
  'surface-active': 'hsl(var(--console-ink) / 0.08)',
  'border-subtle': 'hsl(var(--border) / 0.7)',
  'border-default': 'hsl(var(--border))',
  'border-strong': 'hsl(var(--border-strong))',
};

/**
 * Motion (zhinjs/console#125, soft cards D37). Components never write milliseconds (stylelint
 * `console/motion-tokens`).
 *   fast   120ms  hover, press, colour (with --console-ease-fast)
 *   base   200ms  switches, segments, expanding 「更多」 (with --console-ease-out)
 *   slow   280ms  overlays, dialogs, drawers entering (= enter; with --console-ease-out)
 *   exit   180ms  leaving (with --console-ease-exit)
 *   pulse  1.6s   the breathing dot of in-progress states
 */
export const motion = {
  'motion-fast': '120ms',
  'motion-base': '200ms',
  'motion-slow': '280ms',
  'motion-exit': '180ms',
  'motion-pulse': '1600ms',
};

/**
 * Soft-card palette (ADR 0063 D34, from the soft-card kit's tokens.json — the only source of these
 * values). Hex in the source; the generator writes HSL triplets (`--console-ink: 24 9% 10%`) so
 * every colour works with an alpha (`hsl(var(--console-ink) / 0.04)`), like the palette colours did.
 *
 *   bg → surface → sunken → raised   page, cards, sub-blocks / secondary buttons, overlays (dark: each step lighter)
 *   line                             row dividers (cards have no border)
 *   control                          input borders, the off switch track (≥ 3:1)
 *   ink / muted / faint              text: body and titles / descriptions and units / placeholders
 *   primary / on-primary             black / white: primary button, selection, switch on, current nav item
 *   primary-hover / -soft / -line    hover of primary; selected rows and tab bar item; strong lines
 *   focus                            the 2px focus ring
 *   tint-1…5 / accent-1…5            category colours: light fill + icon colour (icons only, never text)
 *   ok / warn / danger (+ -bg)       states; danger-solid for the confirm button of a dangerous action
 *   progress                         in-progress dots and bars (= accent-1)
 *   inverse / on-inverse             toast surface and text
 * Contrast is checked by tests/contrast.test.ts (the kit's §10 table).
 */
export const palette = {
  light: {
    bg: '#F7F5F3',
    surface: '#FFFFFF',
    sunken: '#F3F0ED',
    raised: '#FFFFFF',
    line: '#ECE7E3',
    control: '#8F877F',
    ink: '#1D1A18',
    muted: '#5F5852',
    faint: '#6E6760',
    primary: '#1D1A18',
    'on-primary': '#FFFFFF',
    'primary-hover': '#3A3532',
    'primary-soft': '#EFECE9',
    'primary-line': '#CFC8C2',
    focus: '#1D1A18',
    'tint-1': '#FDEDE4',
    'accent-1': '#E0602F',
    'tint-2': '#FCEBF1',
    'accent-2': '#D2497A',
    'tint-3': '#F1F5DF',
    'accent-3': '#6E8C24',
    'tint-4': '#E3F4F1',
    'accent-4': '#1E9184',
    'tint-5': '#FCF4DC',
    'accent-5': '#B07A0A',
    ok: '#1F7A3A',
    'ok-bg': '#E3F3E8',
    warn: '#8A6100',
    'warn-bg': '#FFF4D6',
    danger: '#B0213A',
    'danger-bg': '#FCE8EC',
    'danger-solid': '#B0213A',
    'on-danger-solid': '#FFFFFF',
    progress: '#E0602F',
    inverse: '#2A2522',
    'on-inverse': '#F7F3F0',
  },
  dark: {
    bg: '#121010',
    surface: '#1C1918',
    sunken: '#242120',
    raised: '#2A2625',
    line: '#332E2C',
    control: '#78706A',
    ink: '#F2EEEB',
    muted: '#ABA39D',
    faint: '#958D87',
    primary: '#F2EEEB',
    'on-primary': '#1C1918',
    'primary-hover': '#FFFFFF',
    'primary-soft': '#332E2C',
    'primary-line': '#5A524D',
    focus: '#F2EEEB',
    'tint-1': '#3A2219',
    'accent-1': '#F2A487',
    'tint-2': '#3A1C28',
    'accent-2': '#F29AB9',
    'tint-3': '#262D14',
    'accent-3': '#BFD98A',
    'tint-4': '#12302C',
    'accent-4': '#86D9CB',
    'tint-5': '#33290F',
    'accent-5': '#EBCB7A',
    ok: '#5FCB92',
    'ok-bg': '#12291D',
    warn: '#F2C553',
    'warn-bg': '#33290F',
    danger: '#FF7A8A',
    'danger-bg': '#3A1820',
    'danger-solid': '#C42B3F',
    'on-danger-solid': '#FFFFFF',
    progress: '#F2A487',
    inverse: '#F2EEEB',
    'on-inverse': '#1C1918',
  },
};

/**
 * Soft-card paints that are not a single opaque colour (D34): the scrim, the two hero gradients
 * (apricot → pink, mint → cream), the overlay used on hero cards, and the four aurora blobs with
 * their opacity (dark: the dark colours at 50 %, not light colours faded, which would turn grey).
 */
export const paint = {
  light: {
    scrim: 'rgb(30 20 15 / 0.38)',
    'gradient-hero': 'linear-gradient(135deg, #FCE3D6 0%, #F9DDE8 100%)',
    'gradient-hero-2': 'linear-gradient(135deg, #DDF2EA 0%, #FBF0D2 100%)',
    'hero-overlay': 'rgb(255 255 255 / 0.72)',
    'aurora-1': '#FDE3D7',
    'aurora-2': '#DCF2E6',
    'aurora-3': '#FCF1D2',
    'aurora-4': '#FBE1EC',
    'aurora-opacity': '1',
  },
  dark: {
    scrim: 'rgb(0 0 0 / 0.6)',
    'gradient-hero': 'linear-gradient(135deg, #3A2219 0%, #3A1C28 100%)',
    'gradient-hero-2': 'linear-gradient(135deg, #12302C 0%, #33290F 100%)',
    'hero-overlay': 'rgb(255 255 255 / 0.08)',
    'aurora-1': '#4A2216',
    'aurora-2': '#0F3A30',
    'aurora-3': '#43350F',
    'aurora-4': '#43192C',
    'aurora-opacity': '0.5',
  },
};

/**
 * Colour roles of ADR 0063 「色板角色与信号色」 (zhinjs/console#125), kept for compatibility and now
 * resolved onto the soft-card palette (D34). Hex or HSL triplets; the generator writes triplets.
 *
 *   brand / brand-foreground   the brand mark only (#76EEC6 / #7FFFD4, owner 2026-11-16). Buttons no
 *                              longer use it: the primary button is black / white (D34).
 *   brand-text / brand-tint    kept for existing styles; components use ink and primary-soft
 *   signal-*-fill / -text      ok / warn / danger of the palette (the dot and the label share one
 *                              colour). `info` is the in-progress state: progress dot, ink text.
 *   chart-1 … chart-8          the five accents (chart-1, -3, -4, -6, -8) interleaved with three more
 *                              category colours outside blue / purple (D34 原则 3): chart-2 peacock
 *                              (hue ~186°, kept apart from the `ok` green), chart-5 brown, chart-7
 *                              ochre (warm, replaces the deep plum); like the accents, a deeper icon
 *                              colour in light and a lighter one in dark. Neighbours differ by
 *                              ΔE2000 ≥ 20, every pair by ≥ 12, each ≥ 3:1 on the card.
 *                              `chart-other` is the control grey.
 */
export const color = {
  light: {
    brand: '160 78% 69.8%',
    'brand-foreground': '160 80% 10%',
    'brand-text': '160 84% 25%',
    'brand-tint': '160 60% 94%',
    'signal-danger-fill': '#B0213A',
    'signal-danger-text': '#B0213A',
    'signal-warning-fill': '#8A6100',
    'signal-warning-text': '#8A6100',
    'signal-success-fill': '#1F7A3A',
    'signal-success-text': '#1F7A3A',
    'signal-info-fill': '#E0602F',
    'signal-info-text': '#1D1A18',
    'chart-1': '#E0602F',
    'chart-2': '#23575C',
    'chart-3': '#D2497A',
    'chart-4': '#6E8C24',
    'chart-5': '#602E2E',
    'chart-6': '#1E9184',
    'chart-7': '#93461F',
    'chart-8': '#B07A0A',
    'chart-other': '#8F877F',
  },
  dark: {
    brand: '159.8 100% 74.9%',
    'brand-foreground': '160 80% 10%',
    'brand-text': '159.8 100% 74.9%',
    'brand-tint': '160 40% 14%',
    'signal-danger-fill': '#FF7A8A',
    'signal-danger-text': '#FF7A8A',
    'signal-warning-fill': '#F2C553',
    'signal-warning-text': '#F2C553',
    'signal-success-fill': '#5FCB92',
    'signal-success-text': '#5FCB92',
    'signal-info-fill': '#F2A487',
    'signal-info-text': '#F2EEEB',
    'chart-1': '#F2A487',
    'chart-2': '#53A3AC',
    'chart-3': '#F29AB9',
    'chart-4': '#BFD98A',
    'chart-5': '#BD7575',
    'chart-6': '#86D9CB',
    'chart-7': '#C76523',
    'chart-8': '#EBCB7A',
    'chart-other': '#78706A',
  },
};

/** Dark overrides of {@link misc}. */
export const miscDark = {
  'shadow-color': '0 0% 0%',
};

/**
 * Tier 2 + 3: semantic tokens and their value per width (D16 「按尺寸取值」).
 * Values name tier-1 tokens (`space-3`, `r-2`, `e-1`, `hairline`, `focus`) or are sizes
 * (`2.75rem`). `base` applies below 40rem, `sm` from 40rem, `lg` from 64rem.
 * `scope: 'viewport'` tokens follow the viewport (page-level tokens and overlays, which are
 * portaled out of any container); the others follow the nearest `.console-cq` container.
 * `kind` tells the linters and the audit what the token sizes.
 */
export const semantic = {
  // Page level (viewport). Soft cards (D36): page margins 16 on phones, 32 on the web.
  'page-padding-inline': { kind: 'space', scope: 'viewport', base: 'space-4', sm: 'space-5', lg: 'space-6' },
  'page-padding-block': { kind: 'space', scope: 'viewport', base: 'space-4', sm: 'space-5', lg: 'space-6' },
  // Between cards and sections: 12 on phones, 20–24 on the web.
  'section-gap': { kind: 'space', scope: 'viewport', base: 'space-3', sm: 'space-4-5', lg: 'space-5' },
  // Groups and cards (container). Group caption to card: 8.
  'stack-gap': { kind: 'space', base: 'space-2', sm: 'space-3', lg: 'space-3' },
  'inline-gap': { kind: 'space', base: 'space-2', sm: 'space-2', lg: 'space-2' },
  'heading-gap': { kind: 'space', base: 'space-1', sm: 'space-1', lg: 'space-1' },
  // Card padding 16–20 on phones, 24 on the web.
  'card-padding': { kind: 'space', base: 'space-4', sm: 'space-4-5', lg: 'space-5' },
  'card-padding-wide': { kind: 'space', base: 'space-4', sm: 'space-4-5', lg: 'space-5' },
  // Phone cards 24, web cards 28 (D36). Cards have no border; white cards get shadow-sm (e-1).
  'card-radius': { kind: 'radius', base: 'r-6', sm: 'r-7', lg: 'r-7' },
  'card-edge-radius': { kind: 'radius', base: 'r-0', sm: 'r-7', lg: 'r-7' },
  'card-border': { kind: 'border', base: '0px', sm: '0px', lg: '0px' },
  'card-elevation': { kind: 'elevation', base: 'e-1', sm: 'e-1', lg: 'e-1' },
  'card-hover-elevation': { kind: 'elevation', base: 'e-1', sm: 'e-2', lg: 'e-2' },
  // Sub-blocks inside a card (sunken, 18).
  'sub-radius': { kind: 'radius', base: 'r-4', sm: 'r-4', lg: 'r-4' },
  // Hero cards and the floating action bar (24).
  'hero-radius': { kind: 'radius', base: 'r-6', sm: 'r-6', lg: 'r-6' },
  'grid-gap': { kind: 'space', base: 'space-3', sm: 'space-4-5', lg: 'space-5' },
  // Rows: 8 block padding, 16 inline; 56 tall on phones, 52 on the web.
  'list-row-padding': { kind: 'space', base: 'space-2', sm: 'space-2', lg: 'space-2' },
  'list-row-padding-inline': { kind: 'space', base: 'space-4', sm: 'space-4', lg: 'space-4' },
  'list-row-height': { kind: 'size', base: '3.5rem', sm: '3.25rem', lg: '3.25rem' },
  // Dividers between rows (cards are never outlined).
  'divider-width': { kind: 'border', base: 'hairline', sm: 'hairline', lg: 'hairline' },
  // Controls (container): 48 fields and buttons, 36 compact; 40 for segments, steppers, filters.
  'control-height': { kind: 'size', base: '3rem', sm: '3rem', lg: '3rem' },
  'control-height-medium': { kind: 'size', base: '2.5rem', sm: '2.5rem', lg: '2.5rem' },
  'control-height-compact': { kind: 'size', base: '2.75rem', sm: '2.25rem', lg: '2.25rem' },
  // Text fields and menu items: 14. Buttons, chips, segments, switches: pills.
  'control-radius': { kind: 'radius', base: 'r-3', sm: 'r-3', lg: 'r-3' },
  'pill-radius': { kind: 'radius', base: 'r-full', sm: 'r-full', lg: 'r-full' },
  'check-radius': { kind: 'radius', base: 'r-1', sm: 'r-1', lg: 'r-1' },
  'check-border-width': { kind: 'border', base: '1.5px', sm: '1.5px', lg: '1.5px' },
  // Segment buttons inside the pill segmented control.
  'segment-radius': { kind: 'radius', base: 'r-full', sm: 'r-full', lg: 'r-full' },
  'control-padding-inline': { kind: 'space', base: 'space-4', sm: 'space-4', lg: 'space-4' },
  // Buttons: 20 inline padding (16 compact); chips 12.
  'button-padding-inline': { kind: 'space', base: 'space-4-5', sm: 'space-4-5', lg: 'space-4-5' },
  'button-padding-inline-compact': { kind: 'space', base: 'space-4', sm: 'space-4', lg: 'space-4' },
  'chip-padding-inline': { kind: 'space', base: 'space-3', sm: 'space-3', lg: 'space-3' },
  'control-gap': { kind: 'space', base: 'space-2', sm: 'space-2', lg: 'space-2' },
  'control-border': { kind: 'border', base: 'hairline', sm: 'hairline', lg: 'hairline' },
  'touch-min': { kind: 'size', base: '2.75rem', sm: '0rem', lg: '0rem' },
  'badge-height': { kind: 'size', base: '1.5rem', sm: '1.5rem', lg: '1.5rem' },
  'badge-radius': { kind: 'radius', base: 'r-full', sm: 'r-full', lg: 'r-full' },
  'badge-padding-inline': { kind: 'space', base: 'space-3', sm: 'space-3', lg: 'space-3' },
  // Overlays (viewport: they are portaled to <body>). Below 40rem they are bottom sheets.
  // Menus 20 with 46px items (14); dialogs, sheets and drawers 28.
  'popover-radius': { kind: 'radius', scope: 'viewport', base: 'r-7 r-7 r-0 r-0', sm: 'r-5', lg: 'r-5' },
  'popover-item-radius': { kind: 'radius', scope: 'viewport', base: 'r-3', sm: 'r-3', lg: 'r-3' },
  'popover-item-height': { kind: 'size', scope: 'viewport', base: '2.875rem', sm: '2.875rem', lg: '2.875rem' },
  'popover-padding': { kind: 'space', scope: 'viewport', base: 'space-1', sm: 'space-1', lg: 'space-1' },
  'popover-elevation': { kind: 'elevation', scope: 'viewport', base: 'e-3', sm: 'e-3', lg: 'e-3' },
  'dialog-radius': { kind: 'radius', scope: 'viewport', base: 'r-7 r-7 r-0 r-0', sm: 'r-7', lg: 'r-7' },
  'dialog-padding': { kind: 'space', scope: 'viewport', base: 'space-4-5', sm: 'space-5', lg: 'space-5' },
  'dialog-elevation': { kind: 'elevation', scope: 'viewport', base: 'e-3', sm: 'e-3', lg: 'e-3' },
  // Room the header keeps for the dialog / sheet close button.
  'dialog-close-clearance': { kind: 'space', scope: 'viewport', base: 'space-7', sm: 'space-7', lg: 'space-7' },
  'sheet-radius': { kind: 'radius', scope: 'viewport', base: 'r-7', sm: 'r-7', lg: 'r-7' },
  // Table cells and the block padding of multi-line fields: 12.
  'cell-padding': { kind: 'space', base: 'space-3', sm: 'space-3', lg: 'space-3' },
  'field-padding-block': { kind: 'space', base: 'space-3', sm: 'space-3', lg: 'space-3' },
  // Text buttons and danger-text buttons: 12 inline.
  'text-button-padding-inline': { kind: 'space', base: 'space-3', sm: 'space-3', lg: 'space-3' },
  // Skeletons and small colour blocks: 10.
  'skeleton-radius': { kind: 'radius', base: 'r-2', sm: 'r-2', lg: 'r-2' },
  // Floating bars: toasts, the action bar and the tab bar (shadow-md).
  'float-elevation': { kind: 'elevation', scope: 'viewport', base: 'e-2', sm: 'e-2', lg: 'e-2' },
  // Focus ring: focus (2px) + 2px offset at every width.
  'focus-ring-width': { kind: 'border', scope: 'viewport', base: 'focus', sm: 'focus', lg: 'focus' },
  'focus-ring-offset': { kind: 'space', scope: 'viewport', base: '2px', sm: '2px', lg: '2px' },
};

/**
 * Composite semantic tokens built from the ones above (same value at every width, resolved where
 * the component reads them).
 */
export const composite = {
  // The focus ring is the `focus` colour (ink: black / white, D37), 2px with a 2px gap.
  'focus-ring': 'var(--console-focus-ring-width) solid hsl(var(--console-focus))',
  // Text fields (D39): ink border plus a 2px focus ring with a 2px surface gap; danger when invalid.
  'field-focus-ring': '0 0 0 var(--console-focus-ring-offset) hsl(var(--console-surface)), 0 0 0 calc(var(--console-focus-ring-offset) + var(--console-focus-ring-width)) hsl(var(--console-focus))',
  'field-error-ring': '0 0 0 var(--console-focus-ring-offset) hsl(var(--console-surface)), 0 0 0 calc(var(--console-focus-ring-offset) + var(--console-focus-ring-width)) hsl(var(--console-danger))',
  // Keyboard focus inside a list (menu items, options): the 2px focus ring drawn inside the item,
  // so the popover's clipping and the neighbouring items never hide it.
  'focus-ring-inset': 'inset 0 0 0 var(--console-focus-ring-width) hsl(var(--console-focus))',
  // Selected rows (D34): primary-soft fill plus a 3px primary bar on the left.
  'selected-bar': 'inset 0.1875rem 0 0 hsl(var(--console-primary))',
  // In-progress dot: a halo that breathes between these two (D39).
  'progress-halo': '0 0 0 0.1875rem hsl(var(--console-progress) / 0.25)',
  'progress-halo-wide': '0 0 0 0.3125rem hsl(var(--console-progress) / 0.1)',
  // Outline badges: an inner hairline in primary-line.
  'hairline-ring': 'inset 0 0 0 var(--console-border-hairline) hsl(var(--console-primary-line))',
  /* Content width the shell resolved for the current page (D16, D22): `data` unless the page is a reading page. */
  'content-max': 'var(--console-content-data)',
};

/**
 * Old token names, deprecated aliases in 1.1 and removed in ADR 0063 P4. Nothing declares them any
 * more; each maps to its successor (without `--console-`; `null`: no successor, use a hairline
 * border or a semantic elevation). Only the `console/no-deprecated-tokens` stylelint rule reads this
 * table, to point old stylesheets at the new names.
 */
export const removedAliases = {
  // Radii.
  'radius-sm': 'radius-1',
  'radius-md': 'radius-2',
  'radius-lg': 'radius-3',
  'radius-xl': 'radius-4',
  'radius-2xl': 'radius-4',
  // Shadows.
  'shadow-xs': 'elevation-0',
  'shadow-sm': 'card-elevation',
  'shadow-md': 'elevation-2',
  'shadow-lg': 'elevation-3',
  'shadow-xl': 'elevation-3',
  'shadow-panel': 'card-elevation',
  'shadow-hover': 'card-hover-elevation',
  'shadow-button': 'elevation-0',
  // Spacing.
  'space-page-x': 'page-padding-inline',
  'space-page-y': 'page-padding-block',
  'space-section': 'section-gap',
  'space-stack': 'stack-gap',
  'space-card': 'card-padding',
  'space-card-sm': 'card-padding',
  // Controls and borders.
  'control-height-sm': 'control-height-compact',
  'control-height-lg': 'control-height',
  'border-width': 'border-hairline',
  'focus-width': 'border-focus',
  // Motion (zhinjs/console#125): 150ms became motion-fast 120ms, 200ms motion-base.
  'duration-fast': 'motion-fast',
  'duration-page': 'motion-base',
  // Type.
  'text-caption': 'text-label',
  'text-code': 'text-label',
  'text-body-sm': 'text-label',
  'text-section-sm': 'text-section',
  'text-title-compact': 'text-title',
  // Removed without a successor.
  'shadow-ring': null,
};

/**
 * Sizes for `w-*` / `h-*` / `size-*` / `inset-*` / `min-*` / `max-*` / `translate-*` / `basis-*`
 * (D17: not limited by the spacing scale; e.g. `h-11` is the 44px touch target). These are
 * Tailwind's default numeric keys; each is `n × 0.25rem`.
 */
export const sizingKeys = [
  '0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '52', '56', '60', '64', '72', '80', '96',
];

/** Semantic size keys for the same utilities (`h-control`, `size-touch`, …). */
export const semanticSizes = {
  control: 'var(--console-control-height)',
  'control-medium': 'var(--console-control-height-medium)',
  'control-compact': 'var(--console-control-height-compact)',
  tile: 'var(--console-size-tile-md)',
  'tile-sm': 'var(--console-size-tile-sm)',
  'tile-lg': 'var(--console-size-tile-lg)',
  'icon-button': 'var(--console-size-icon-button)',
  touch: 'var(--console-touch-target)',
  'touch-min': 'var(--console-touch-min)',
  badge: 'var(--console-badge-height)',
};
