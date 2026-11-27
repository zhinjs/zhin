/**
 * Tailwind class checks of ADR 0063 D17 / D20, shared by the ESLint plugin
 * (`@zhin.js/console-ui/eslint`) and `zhin plugin check` (`@zhin.js/console-ui/tailwind-classes`).
 *
 *   classifyClass('p-7')            → { rule: 'off-scale', … }   spacing key not in 0, px, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16
 *   classifyClass('p-[5px]')        → { rule: 'arbitrary', … }   arbitrary value of a scale utility
 *   classifyClass('shadow-md')      → { rule: 'off-scale', … }   Tailwind default shadow
 *   classifyClass('h-11')           → null                       sizing keys are not limited by the spacing scale
 *   classifyClass('bg-[hsl(var(--primary))]') → null             colors from theme tokens are fine
 *
 * The allowed keys come from tokens/scale.mjs, the same derivation as the generated theme.
 */
import { buildScale } from '../tokens/scale.mjs';

const scale = buildScale();
const SPACING = new Set(scale.tailwind.spacingKeys);
const SIZING = new Set(scale.tailwind.sizingKeys);
const RADIUS = new Set(scale.tailwind.radiusKeys);
const SHADOW = new Set(scale.tailwind.shadowKeys);
const TEXT = new Set(scale.tailwind.textKeys);
const WEIGHT = new Set(scale.tailwind.fontWeightKeys);

// Tailwind's default sizes that are not on the console-ui scale (xs, sm, lg, xl and 2xl are: the
// soft-card scale reuses those names with its own values, ADR 0063 D35).
const TAILWIND_TEXT_SIZES = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'].filter((size) => !TEXT.has(size)));
const TAILWIND_WEIGHTS = new Set(['thin', 'extralight', 'light', 'normal', 'semibold', 'bold', 'extrabold', 'black']);
const GOVERNED_PROPERTIES = /^\[(?:padding|margin|gap|row-gap|column-gap|font-size|font-weight|border-radius|box-shadow|border(?:-[a-z]+)?-width)(?:-[a-z]+)?:/u;
const COLOR_VALUE = /^\[(?:color:|hsl|rgb|oklch|oklab|lab|lch|hwb|#|transparent|currentcolor)/iu;

/** Splits off variants (`md:hover:p-4` → `p-4`), the important flag and the negative sign. */
export function utilityOf(token) {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    else if (char === ':' && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!|!$/gu, '').replace(/^-/u, '').replace(/\/[^/\]]+$/u, (opacity) => (opacity.includes('[') ? opacity : ''));
}

const isArbitrary = (value) => value.startsWith('[') || value.startsWith('(');

/**
 * @param {string} token one class name
 * @returns {null | { rule: 'arbitrary' | 'off-scale', message: string }}
 */
export function classifyClass(token) {
  const utility = utilityOf(token);
  if (!utility) return null;
  // CSS-wide keywords carry no value of their own (`rounded-[inherit]`).
  if (/-\[(?:inherit|initial|unset|revert)\]$/u.test(utility)) return null;
  const arbitrary = (what) => ({ rule: 'arbitrary', message: `\`${token}\`: arbitrary ${what} value; use a scale key or a component (ADR 0063 D20)` });
  const offScale = (what, allowed) => ({ rule: 'off-scale', message: `\`${token}\`: ${what} is not on the scale (allowed: ${allowed}); see ADR 0063 D17` });

  if (GOVERNED_PROPERTIES.test(utility)) return arbitrary('property');

  let match = /^(?:p[xytrblse]?|p(?:bs|be)|m[xytrblse]?|m(?:bs|be)|gap(?:-[xy])?|space-[xy])-(.+)$/u.exec(utility);
  if (match) {
    const value = match[1];
    if (isArbitrary(value)) return arbitrary('spacing');
    if (value === 'auto' || value === 'reverse') return null;
    if (!SPACING.has(value)) return offScale('spacing key', [...SPACING].join(', '));
    return null;
  }

  match = /^(?:w|h|size|min-w|min-h|max-w|max-h|inset(?:-[xy])?|top|right|bottom|left|start|end|translate-[xy]|basis)-(.+)$/u.exec(utility);
  if (match) {
    const value = match[1];
    if (/^\d+(?:\.\d+)?$/u.test(value) && !SIZING.has(value)) return offScale('size key', 'Tailwind numeric keys up to 96 and control, control-medium, control-compact, tile, tile-sm, tile-lg, icon-button, touch, touch-min, badge');
    return null;
  }

  match = /^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(.+))?$/u.exec(utility);
  if (match) {
    const value = match[1];
    if (value === undefined) return offScale('bare `rounded`', [...RADIUS].map((key) => `rounded-${key}`).join(', '));
    if (isArbitrary(value)) return arbitrary('radius');
    if (!RADIUS.has(value)) return offScale('radius key', [...RADIUS].join(', '));
    return null;
  }

  match = /^shadow(?:-(.+))?$/u.exec(utility);
  if (match) {
    const value = match[1];
    if (value === undefined) return offScale('bare `shadow`', [...SHADOW].map((key) => `shadow-${key}`).join(', '));
    if (isArbitrary(value)) return arbitrary('shadow');
    if (!SHADOW.has(value)) return offScale('shadow', [...SHADOW].join(', '));
    return null;
  }

  match = /^text-(.+)$/u.exec(utility);
  if (match) {
    const value = match[1];
    if (isArbitrary(value)) return COLOR_VALUE.test(value) ? null : arbitrary('font-size');
    if (TAILWIND_TEXT_SIZES.has(value)) return offScale('font size', [...TEXT].map((key) => `text-${key}`).join(', '));
    return null;
  }

  match = /^font-(.+)$/u.exec(utility);
  if (match) {
    const value = match[1];
    if (isArbitrary(value)) return arbitrary('font');
    if (TAILWIND_WEIGHTS.has(value)) return offScale('font weight', [...WEIGHT].map((key) => `font-${key}`).join(', '));
    return null;
  }

  match = /^border(?:-[xytrblse])?-(\d+|\[.+\]|\(.+\))$/u.exec(utility);
  if (match) {
    const value = match[1];
    if (isArbitrary(value)) return COLOR_VALUE.test(value) ? null : arbitrary('border width');
    if (value !== '0') return offScale('border width', 'border (hairline), border-0');
    return null;
  }

  return null;
}

/** All findings in a whitespace-separated class string. */
export function classifyClassList(value) {
  return value.split(/\s+/u).filter(Boolean).map((token) => ({ token, finding: classifyClass(token) })).filter((entry) => entry.finding);
}
