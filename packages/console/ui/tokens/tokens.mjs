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
 * Colors stay in tokens/colors.css (hand-written, also defined only once) and are copied into
 * tokens.css by the generator.
 */

/** Breakpoints (D16). Media queries are for the global shell only; components use containers. */
export const breakpoints = {
  sm: '40rem',
  md: '48rem',
  lg: '64rem',
  xl: '90rem',
};

/** Type scale: at most 5 sizes (D16). `display` is only for stat values and page titles. */
export const text = {
  label: { size: '0.8125rem', leading: '1.45' },
  body: { size: '0.875rem', leading: '1.6' },
  section: { size: '1rem', leading: '1.4' },
  title: { size: '1.375rem', leading: '1.25' },
  display: { size: '1.75rem', leading: '1.15' },
};

/** Font weights: at most 3 (D16). */
export const weight = {
  regular: '400',
  medium: '500',
  strong: '600',
};

/**
 * Spacing: space-1 … space-8 on a 4px grid (D16). `tailwind` is the Tailwind key with the same
 * value (D17): the names diverge from space-5 on (space-5 is `p-6`).
 */
export const space = {
  'space-1': { value: '0.25rem', tailwind: '1' },
  'space-2': { value: '0.5rem', tailwind: '2' },
  'space-3': { value: '0.75rem', tailwind: '3' },
  'space-4': { value: '1rem', tailwind: '4' },
  'space-5': { value: '1.5rem', tailwind: '6' },
  'space-6': { value: '2rem', tailwind: '8' },
  'space-7': { value: '3rem', tailwind: '12' },
  'space-8': { value: '4rem', tailwind: '16' },
};

/** Radii (D16). No `calc(… - Npx)` radii any more. */
export const radius = {
  'r-0': '0rem',
  'r-1': '0.375rem',
  'r-2': '0.625rem',
  'r-3': '0.875rem',
  'r-4': '1.125rem',
  'r-full': '9999px',
};

/** Borders (D16): hairline for every divider and outline, focus only for focus rings. */
export const border = {
  hairline: '1px',
  focus: '2px',
};

/**
 * Elevation (D16): e-0 none, e-1 hover, e-2 dropdown / popover, e-3 dialog / drawer.
 * Light theme: soft drops (shadows are for overlays; static content uses hairlines). Dark theme:
 * edges and surface lightness only (a hairline ring, no drop).
 */
export const elevation = {
  light: {
    'e-0': 'none',
    'e-1': '0 1px 2px hsl(var(--console-shadow-color) / 0.06), 0 2px 6px -2px hsl(var(--console-shadow-color) / 0.08)',
    'e-2': '0 6px 16px -4px hsl(var(--console-shadow-color) / 0.12), 0 2px 4px -2px hsl(var(--console-shadow-color) / 0.06)',
    'e-3': '0 24px 48px -12px hsl(var(--console-shadow-color) / 0.2), 0 4px 12px -4px hsl(var(--console-shadow-color) / 0.08)',
  },
  dark: {
    'e-0': 'none',
    'e-1': '0 0 0 1px hsl(0 0% 100% / 0.08)',
    'e-2': '0 0 0 1px hsl(0 0% 100% / 0.1)',
    'e-3': '0 0 0 1px hsl(0 0% 100% / 0.12)',
  },
};

/** Content widths (D16, D18): reading / form pages and data pages. */
export const contentWidth = {
  reading: '60rem',
  data: '120rem',
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
  'font-sans': "'Inter', 'MiSans', 'SF Pro Text', -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  'font-mono': "'JetBrains Mono', 'SF Mono', 'Cascadia Code', ui-monospace, Menlo, Consolas, 'Noto Sans Mono CJK SC', monospace",
  'line-code': '1.25rem',
  'leading-code': '1.6',
  'shadow-color': '222 30% 12%',
  // The one easing curve of every transition and animation (ADR 0063 「色板角色与信号色」, zhinjs/console#125).
  'ease-out': 'cubic-bezier(0.25, 1, 0.5, 1)',
  'surface-raised': 'hsl(var(--card))',
  'surface-muted': 'hsl(var(--secondary))',
  'surface-inset': 'hsl(var(--secondary))',
  'surface-hover': 'hsl(var(--foreground) / 0.045)',
  'surface-active': 'hsl(var(--foreground) / 0.08)',
  'border-subtle': 'hsl(var(--border) / 0.7)',
  'border-default': 'hsl(var(--border))',
  'border-strong': 'hsl(var(--border-strong))',
};

/**
 * Motion (zhinjs/console#125): three durations, all with `--console-ease-out`. Components never
 * write milliseconds (stylelint `console/motion-tokens`).
 *   fast  hover, press, color changes
 *   base  expand / collapse, popovers, toasts
 *   slow  drawers, sheets, page transitions
 */
export const motion = {
  'motion-fast': '120ms',
  'motion-base': '200ms',
  'motion-slow': '280ms',
};

/**
 * Color roles that do not follow the palette (ADR 0063 「色板角色与信号色」, zhinjs/console#125).
 * HSL triplets like the palette colors (`hsl(var(--console-brand) / 0.1)`); one value per theme.
 *
 *   brand                 #76EEC6 (light) / #7FFFD4 (dark), owner's decision 2026-11-16 — the fill of
 *                         the brand mark and of the one solid primary button of a view. The same
 *                         under every palette. Too light for text or thin lines on light surfaces.
 *   brand-foreground      text and the Z on brand (dark teal, ≥ 4.5:1)
 *   brand-text            brand as text or a thin line — links, focus ring, selection marks: the
 *                         same hue darkened to ≥ 4.5:1 on light surfaces; #7FFFD4 in the dark theme
 *   brand-tint            quiet brand surfaces (selected rows)
 *   signal-*-fill         bright: dots, bars, gauges, icons, badge tints — never text
 *   signal-*-text         the same hue darkened (light) / lightened (dark) to ≥ 4.5:1 for text
 *                         Hue and saturation are the same in both themes; only lightness changes.
 *   chart-1 … chart-8     categorical data colors, independent of the palette; neighbours differ
 *                         by ΔE2000 ≥ 20 in both themes. `chart-other` is the 「其他」 series.
 *
 * Steady states (running, succeeded, 0 failures) use no signal color; failures and rejections
 * must be more prominent than successes.
 */
export const color = {
  light: {
    brand: '160 78% 69.8%',
    'brand-foreground': '160 80% 10%',
    'brand-text': '160 84% 25%',
    'brand-tint': '160 60% 94%',
    'signal-danger-fill': '0 76% 54%',
    'signal-danger-text': '0 76% 40%',
    'signal-warning-fill': '38 92% 50%',
    'signal-warning-text': '38 92% 26%',
    'signal-success-fill': '145 60% 40%',
    'signal-success-text': '145 60% 25%',
    'signal-info-fill': '217 84% 56%',
    'signal-info-text': '217 84% 42%',
    'chart-1': '217 74% 50%',
    'chart-2': '32 94% 42%',
    'chart-3': '164 72% 32%',
    'chart-4': '330 66% 48%',
    'chart-5': '262 56% 56%',
    'chart-6': '48 92% 32%',
    'chart-7': '192 80% 38%',
    'chart-8': '8 66% 46%',
    'chart-other': '220 6% 58%',
  },
  dark: {
    brand: '159.8 100% 74.9%',
    'brand-foreground': '160 80% 10%',
    'brand-text': '159.8 100% 74.9%',
    'brand-tint': '160 40% 14%',
    'signal-danger-fill': '0 76% 58%',
    'signal-danger-text': '0 76% 70%',
    'signal-warning-fill': '38 92% 52%',
    'signal-warning-text': '38 92% 62%',
    'signal-success-fill': '145 60% 44%',
    'signal-success-text': '145 60% 58%',
    'signal-info-fill': '217 84% 62%',
    'signal-info-text': '217 84% 72%',
    'chart-1': '217 80% 66%',
    'chart-2': '32 92% 58%',
    'chart-3': '164 60% 48%',
    'chart-4': '330 72% 62%',
    'chart-5': '262 70% 74%',
    'chart-6': '48 86% 56%',
    'chart-7': '192 70% 52%',
    'chart-8': '8 72% 64%',
    'chart-other': '220 6% 50%',
  },
};

/** Dark overrides of {@link misc}. */
export const miscDark = {
  'shadow-color': '0 0% 0%',
  'surface-hover': 'hsl(0 0% 100% / 0.05)',
  'surface-active': 'hsl(0 0% 100% / 0.09)',
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
  // Page level (viewport).
  'page-padding-inline': { kind: 'space', scope: 'viewport', base: 'space-3', sm: 'space-4', lg: 'clamp(space-4, 2.5vw, space-6)' },
  'page-padding-block': { kind: 'space', scope: 'viewport', base: 'space-4', sm: 'space-5', lg: 'space-6' },
  'section-gap': { kind: 'space', scope: 'viewport', base: 'space-4', sm: 'space-5', lg: 'space-6' },
  // Groups and cards (container).
  'stack-gap': { kind: 'space', base: 'space-2', sm: 'space-3', lg: 'space-3' },
  'inline-gap': { kind: 'space', base: 'space-2', sm: 'space-2', lg: 'space-2' },
  'heading-gap': { kind: 'space', base: 'space-1', sm: 'space-1', lg: 'space-1' },
  'card-padding': { kind: 'space', base: 'space-3', sm: 'space-4', lg: 'space-4' },
  'card-padding-wide': { kind: 'space', base: 'space-3', sm: 'space-4', lg: 'space-5' },
  'card-radius': { kind: 'radius', base: 'r-2', sm: 'r-3', lg: 'r-3' },
  'card-edge-radius': { kind: 'radius', base: 'r-0', sm: 'r-3', lg: 'r-3' },
  'card-border': { kind: 'border', base: 'hairline', sm: 'hairline', lg: 'hairline' },
  'card-elevation': { kind: 'elevation', base: 'e-0', sm: 'e-0', lg: 'e-0' },
  'card-hover-elevation': { kind: 'elevation', base: 'e-0', sm: 'e-0', lg: 'e-1' },
  'grid-gap': { kind: 'space', base: 'space-2', sm: 'space-3', lg: 'space-4' },
  'list-row-padding': { kind: 'space', base: 'space-3', sm: 'space-2', lg: 'space-2' },
  'list-row-padding-inline': { kind: 'space', base: 'space-3', sm: 'space-3', lg: 'space-3' },
  // Controls (container).
  'control-height': { kind: 'size', base: '2.75rem', sm: '2.25rem', lg: '2.25rem' },
  'control-height-compact': { kind: 'size', base: '2.75rem', sm: '2.25rem', lg: '2rem' },
  'control-radius': { kind: 'radius', base: 'r-2', sm: 'r-2', lg: 'r-2' },
  'check-radius': { kind: 'radius', base: 'r-1', sm: 'r-1', lg: 'r-1' },
  // Items inside a segmented control (tabs): control radius − its space-1 padding (D16 nested radii).
  'segment-radius': { kind: 'radius', base: 'r-1', sm: 'r-1', lg: 'r-1' },
  'control-padding-inline': { kind: 'space', base: 'space-3', sm: 'space-3', lg: 'space-3' },
  'control-gap': { kind: 'space', base: 'space-2', sm: 'space-2', lg: 'space-2' },
  'control-border': { kind: 'border', base: 'hairline', sm: 'hairline', lg: 'hairline' },
  'touch-min': { kind: 'size', base: '2.75rem', sm: '0rem', lg: '0rem' },
  'badge-height': { kind: 'size', base: '1.25rem', sm: '1.25rem', lg: '1.25rem' },
  'badge-radius': { kind: 'radius', base: 'r-full', sm: 'r-full', lg: 'r-full' },
  'badge-padding-inline': { kind: 'space', base: 'space-2', sm: 'space-2', lg: 'space-2' },
  // Overlays (viewport: they are portaled to <body>). Below 40rem they are bottom drawers.
  'popover-radius': { kind: 'radius', scope: 'viewport', base: 'r-4 r-4 r-0 r-0', sm: 'r-3', lg: 'r-3' },
  'popover-item-radius': { kind: 'radius', scope: 'viewport', base: 'r-3', sm: 'r-2', lg: 'r-2' },
  'popover-padding': { kind: 'space', scope: 'viewport', base: 'space-1', sm: 'space-1', lg: 'space-1' },
  'popover-elevation': { kind: 'elevation', scope: 'viewport', base: 'e-3', sm: 'e-2', lg: 'e-2' },
  'dialog-radius': { kind: 'radius', scope: 'viewport', base: 'r-4 r-4 r-0 r-0', sm: 'r-4', lg: 'r-4' },
  'dialog-padding': { kind: 'space', scope: 'viewport', base: 'space-4', sm: 'space-5', lg: 'space-5' },
  'dialog-elevation': { kind: 'elevation', scope: 'viewport', base: 'e-3', sm: 'e-3', lg: 'e-3' },
  // Room the header keeps for the dialog / sheet close button.
  'dialog-close-clearance': { kind: 'space', scope: 'viewport', base: 'space-7', sm: 'space-7', lg: 'space-7' },
  'sheet-radius': { kind: 'radius', scope: 'viewport', base: 'r-4', sm: 'r-4', lg: 'r-4' },
  // Focus ring: focus (2px) + 2px offset at every width.
  'focus-ring-width': { kind: 'border', scope: 'viewport', base: 'focus', sm: 'focus', lg: 'focus' },
  'focus-ring-offset': { kind: 'space', scope: 'viewport', base: '2px', sm: '2px', lg: '2px' },
};

/**
 * Composite semantic tokens built from the ones above (same value at every width, resolved where
 * the component reads them).
 */
export const composite = {
  // The focus ring is brand-text (zhinjs/console#125), the same under every palette.
  'focus-ring': 'var(--console-focus-ring-width) solid hsl(var(--console-brand-text))',
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
  'control-compact': 'var(--console-control-height-compact)',
  touch: 'var(--console-touch-target)',
  'touch-min': 'var(--console-touch-min)',
  badge: 'var(--console-badge-height)',
};
