/**
 * Stylelint plugin of @zhin.js/console-ui (`@zhin.js/console-ui/stylelint-plugin`, ADR 0063 D20 第 1 条).
 *
 * Rules (allowed values come from tokens/scale.mjs, the same derivation as the generated files):
 *   console/scale-values          font-size, font-weight, border-radius, box-shadow, border-width,
 *                                 padding, margin, gap: only `0`, keywords and `var(--console-…)`
 *                                 (also inside calc / min / max / clamp). With `{ semanticOnly: true }`
 *                                 spacing, radius and elevation must be tier-2 (semantic) tokens.
 *   console/no-unknown-tokens     `var(--console-…)` names that are not defined
 *   console/no-deprecated-tokens  old names kept as aliases until P4 (`--console-radius-md`, …)
 *   console/media-queries         `@media` only in shell files (`{ shellFiles: [regex…] }`) and only
 *                                 with the generated breakpoints; `@container` only with breakpoints
 *   console/motion-tokens         transition / animation (and their -duration / -delay /
 *                                 -timing-function): no time literals (`150ms`, `0.2s`) and no easing
 *                                 literals (`ease`, `cubic-bezier(…)`); use --console-motion-fast /
 *                                 -base / -slow and --console-ease-out (zhinjs/console#125). The
 *                                 `prefers-reduced-motion: reduce` reset is exempt.
 */
import stylelint from 'stylelint';
import { buildScale } from '../tokens/scale.mjs';

const { createPlugin, utils } = stylelint;
const scale = buildScale();
const BASE = new Set(scale.css.baseTokens);
const SEMANTIC = new Set(scale.css.semanticTokens);
const ALIASES = new Set(scale.css.aliasTokens.filter((name) => name.startsWith('--console-')));
const KNOWN = new Set([...BASE, ...SEMANTIC, ...ALIASES]);
/** Tier-1 tokens that have semantic replacements (D16: components use tier 2). */
const TIER_ONE_SIZED = /^--console-(?:space-[1-8]|radius-(?:\d|full)|elevation-\d|border-(?:hairline|focus))$/u;
const MEDIA = new Set(scale.css.mediaParams.map(normalizeParams));
const CONTAINER = new Set(scale.css.containerParams.map(normalizeParams));
const CUSTOM_MEDIA = new Set(Object.keys(scale.css.customMedia));

const GOVERNED = /^(?:font-size|font-weight|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-width)?|border-width|border-(?:top|bottom|start|end)-(?:left|right|start|end)-radius|border-radius|box-shadow|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap)$/u;
const KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none', 'normal', 'auto', 'solid', 'dashed', 'dotted', 'double', 'transparent', 'currentcolor']);

function normalizeParams(params) {
  return params.replace(/\s+/gu, ' ').replace(/\(\s+/gu, '(').replace(/\s+\)/gu, ')').trim().toLowerCase();
}

/** Removes balanced `name(...)` calls for the given function names. */
function stripCalls(value, names) {
  let out = value;
  for (;;) {
    const match = new RegExp(`\\b(?:${names.join('|')})\\(`, 'iu').exec(out);
    if (!match) return out;
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < out.length; end += 1) {
      if (out[end] === '(') depth += 1;
      else if (out[end] === ')') { depth -= 1; if (depth === 0) break; }
    }
    out = `${out.slice(0, match.index)} ${out.slice(end + 1)}`;
  }
}

function varsIn(value) {
  return [...value.matchAll(/var\(\s*(--[a-z0-9-]+)/giu)].map((match) => match[1]);
}

/** Literal values left after removing allowed parts (tokens, keywords, colors in borders). */
function literalsIn(property, value) {
  let rest = value.replace(/!important/giu, '');
  rest = stripCalls(rest, ['var', 'env']);
  if (/^border/u.test(property) && !/radius/u.test(property)) rest = stripCalls(rest, ['hsl', 'hsla', 'rgb', 'rgba', 'oklch', 'oklab', 'color-mix']).replace(/#[0-9a-f]{3,8}\b/giu, ' ');
  rest = rest.replace(/\b(?:calc|min|max|clamp)\(/giu, ' ').replace(/[(),*+/]/gu, ' ');
  const literals = [];
  for (const word of rest.split(/\s+/u).filter(Boolean)) {
    if (KEYWORDS.has(word.toLowerCase())) continue;
    if (/^-$/u.test(word)) continue;
    const number = /^-?(\d*\.?\d+)([a-z%]*)$/iu.exec(word);
    if (number) {
      if (Number(number[1]) === 0) continue;
      if (!number[2] && property !== 'font-weight') continue; // calc multipliers
      literals.push(word);
      continue;
    }
    if (property === 'font-weight' && /^(?:bold|bolder|lighter)$/iu.test(word)) literals.push(word);
  }
  return literals;
}

const scaleValuesName = 'console/scale-values';
const scaleValues = createPlugin(scaleValuesName, (primary, secondary = {}) => (root, result) => {
  if (!utils.validateOptions(result, scaleValuesName, { actual: primary })) return;
  const semanticOnly = Boolean(secondary.semanticOnly);
  const allowTierOne = (secondary.allowTierOneIn ?? []).map((source) => new RegExp(source, 'u'));
  const file = root.source?.input.file ?? '';
  const tierOneAllowed = allowTierOne.some((pattern) => pattern.test(file));
  root.walkDecls((decl) => {
    const property = decl.prop.toLowerCase();
    if (property.startsWith('--') || !GOVERNED.test(property)) return;
    if (property === 'box-shadow' && /\b(?:hsla?|rgba?|oklch)\(|#[0-9a-f]{3,8}\b/iu.test(stripCalls(decl.value, ['var']))) {
      utils.report({ ruleName: scaleValuesName, result, node: decl, message: `box-shadow: literal shadow; use an elevation token (ADR 0063 D16) (${scaleValuesName})` });
      return;
    }
    for (const literal of literalsIn(property, decl.value)) {
      utils.report({ ruleName: scaleValuesName, result, node: decl, word: literal, message: `${property}: literal "${literal}"; use a Console token (var(--console-…)) or 0 (ADR 0063 D20) (${scaleValuesName})` });
    }
    if (semanticOnly && !tierOneAllowed) {
      for (const name of varsIn(decl.value)) {
        if (TIER_ONE_SIZED.test(name)) {
          utils.report({ ruleName: scaleValuesName, result, node: decl, word: name, message: `${property}: ${name} is a base-scale token; components use semantic tokens (ADR 0063 D16) (${scaleValuesName})` });
        }
      }
    }
  });
});
scaleValues.ruleName = scaleValuesName;

const unknownName = 'console/no-unknown-tokens';
const unknownTokens = createPlugin(unknownName, (primary) => (root, result) => {
  if (!utils.validateOptions(result, unknownName, { actual: primary })) return;
  const defined = new Set();
  root.walkDecls(/^--console-/u, (decl) => defined.add(decl.prop));
  root.walkDecls((decl) => {
    for (const name of varsIn(decl.value)) {
      if (!name.startsWith('--console-') || KNOWN.has(name) || defined.has(name)) continue;
      utils.report({ ruleName: unknownName, result, node: decl, word: name, message: `${name} is not a Console token (${unknownName})` });
    }
  });
});

const deprecatedName = 'console/no-deprecated-tokens';
const deprecatedTokens = createPlugin(deprecatedName, (primary) => (root, result) => {
  if (!utils.validateOptions(result, deprecatedName, { actual: primary })) return;
  root.walkDecls((decl) => {
    for (const name of varsIn(decl.value)) {
      if (ALIASES.has(name)) utils.report({ ruleName: deprecatedName, result, node: decl, word: name, message: `${name} is deprecated (alias until ADR 0063 P4); use its successor (${deprecatedName})` });
    }
  });
});

const mediaName = 'console/media-queries';
const mediaQueries = createPlugin(mediaName, (primary, secondary = {}) => (root, result) => {
  if (!utils.validateOptions(result, mediaName, { actual: primary })) return;
  const shellFiles = (secondary.shellFiles ?? []).map((source) => new RegExp(source, 'u'));
  const file = root.source?.input.file ?? '';
  const isShell = shellFiles.some((pattern) => pattern.test(file));
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === 'media') {
      if (!isShell) {
        utils.report({ ruleName: mediaName, result, node: rule, message: `@media only in shell files; components follow their container (@container), ADR 0063 D18 (${mediaName})` });
        return;
      }
      for (const query of rule.params.split(',')) {
        for (const part of query.split(/\band\b/iu)) {
          const normalized = normalizeParams(part);
          const custom = /^\((--[a-z0-9-]+)\)$/u.exec(normalized);
          if (custom ? CUSTOM_MEDIA.has(custom[1]) : MEDIA.has(normalized)) continue;
          utils.report({ ruleName: mediaName, result, node: rule, word: part.trim(), message: `@media ${part.trim()}: only the Console breakpoints (${Object.keys(scale.css.customMedia).filter((key) => !key.includes('below')).join(', ')}) and user preferences (${mediaName})` });
        }
      }
    }
    if (name === 'container') {
      const params = normalizeParams(rule.params.replace(/^[a-z][a-z0-9-]*\s+(?=\()/iu, ''));
      if (!CONTAINER.has(params)) {
        utils.report({ ruleName: mediaName, result, node: rule, message: `@container ${rule.params}: only the Console breakpoints (${Object.values(scale.breakpoints).join(', ')}) (${mediaName})` });
      }
    }
  });
});

const motionName = 'console/motion-tokens';
const MOTION_PROPERTY = /^(?:transition|animation)(?:-(?:duration|delay|timing-function))?$/u;
const EASING_KEYWORDS = new Set(['ease', 'ease-in', 'ease-out', 'ease-in-out']);

function inReducedMotionReset(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media' && /prefers-reduced-motion:\s*reduce/iu.test(parent.params)) return true;
  }
  return false;
}

const motionTokens = createPlugin(motionName, (primary) => (root, result) => {
  if (!utils.validateOptions(result, motionName, { actual: primary })) return;
  root.walkDecls((decl) => {
    const property = decl.prop.toLowerCase();
    if (!MOTION_PROPERTY.test(property) || inReducedMotionReset(decl)) return;
    const rest = stripCalls(decl.value, ['var', 'env']);
    for (const match of rest.matchAll(/(?<![\w-])(-?\d*\.?\d+)(ms|s)\b/giu)) {
      if (Number(match[1]) === 0) continue;
      utils.report({ ruleName: motionName, result, node: decl, word: match[0], message: `${property}: literal duration "${match[0]}"; use var(--console-motion-fast | -base | -slow) (zhinjs/console#125) (${motionName})` });
    }
    const easings = [...rest.matchAll(/\b(?:cubic-bezier|steps)\(/giu)].map((match) => match[0].slice(0, -1));
    easings.push(...rest.split(/[\s,]+/u).filter((word) => EASING_KEYWORDS.has(word.toLowerCase())));
    for (const easing of easings) {
      utils.report({ ruleName: motionName, result, node: decl, word: easing, message: `${property}: literal easing "${easing}"; use var(--console-ease-out) (zhinjs/console#125) (${motionName})` });
    }
  });
});

export const consoleStylelintPlugins = [scaleValues, unknownTokens, deprecatedTokens, mediaQueries, motionTokens];
export default consoleStylelintPlugins;
