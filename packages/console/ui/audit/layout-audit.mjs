/**
 * Playwright layout audit of ADR 0063 D20 第 3 条 (`@zhin.js/console-ui/audit`).
 *
 * Reads the computed style of every element at 375 / 768 / 1280 / 1920 px in the light and dark
 * theme and checks:
 *   type-scale      ≤ 5 font sizes, ≤ 3 weights, all on the scale (D16)
 *   spacing         padding and gap on the space scale (or a resolved semantic spacing token)
 *   radius / border / shadow   border-radius, border-width, box-shadow on the scale
 *   consistency     one radius / border / shadow per component kind (`data-slot`) and width
 *   overflow        no page-level horizontal scroll, no element pushed out of the viewport
 *   touch-target    ≥ 44 × 44 px interactive targets at 375 (an `::after` hit area counts)
 *   edge-card       edge-to-edge cards have no radius at 375
 *   static-card     static cards have no shadow
 *   bottom-drawer   open menus, selects and dialogs are bottom drawers at 375
 *   content-width   data pages ≥ 85 % of a 1920 viewport, reading pages ≤ 60rem
 *   duplicate-text  the same explanation at most once per page
 *   focus-visible   every focusable element shows a focus style (D19)
 *   contrast        text readable on its background, WCAG 4.5 / 3 (D19)
 *   shell-overlap   page content does not use position: fixed or a z-index above the shell (D19)
 *
 * Gate or report: {@link auditPage} only collects violations; the caller decides. The
 * `@zhin.js/console-ui` gallery is a gate (visual/audit.spec.ts); Console and plugin pages run the
 * same function and only report (see audit/cli.mjs) until they join the gate (D20, D21).
 *
 * Exemptions (D19: only with a reason, reviewed): an element (and its subtree) with
 * `data-zhin-ui-ignore="<check>[,<check>…]: <reason>"` is skipped for those checks; every exemption
 * is listed in the result. Check ids are {@link AUDIT_CHECKS}.
 */
import { buildScale } from '../tokens/scale.mjs';

export const AUDIT_WIDTHS = Object.freeze([375, 768, 1280, 1920]);
export const AUDIT_THEMES = Object.freeze(['light', 'dark']);
export const AUDIT_CHECKS = Object.freeze([
  'type-scale', 'spacing', 'radius', 'border', 'shadow', 'consistency', 'overflow', 'touch-target',
  'edge-card', 'static-card', 'bottom-drawer', 'content-width', 'duplicate-text', 'focus-visible',
  'contrast', 'shell-overlap',
]);

/** Default theme switch: the Console's `.dark` class on <html>. */
export async function setConsoleTheme(page, theme) {
  await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
}

/**
 * Audits the page as it is now (viewport, theme and open overlays are the caller's).
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {string} [options.contentSelector] page content root (default `[data-slot=page-content]`, else body)
 * @param {'data'|'reading'|'full'} [options.pageType] defaults to the content root's `data-width`, else `data`
 * @param {string[]} [options.checks] subset of {@link AUDIT_CHECKS}
 * @param {number} [options.maxFocusSteps] Tab presses for the focus check (default 40)
 * @returns {Promise<{ width: number, height: number, theme: string, violations: object[], exemptions: object[] }>}
 */
export async function auditPage(page, options = {}) {
  const scale = buildScale();
  const checks = new Set(options.checks ?? AUDIT_CHECKS);
  const result = await page.evaluate(collect, {
    scale: {
      text: Object.values(scale.text),
      weight: Object.values(scale.weight),
      space: Object.values(scale.space).map((entry) => entry.value),
      radius: Object.values(scale.radius),
      border: Object.values(scale.border),
      readingWidth: scale.contentWidth.reading,
      touchTarget: scale.touchTarget,
      breakpointSm: scale.breakpoints.sm,
    },
    checks: [...checks],
    contentSelector: options.contentSelector ?? '[data-slot=page-content]',
    pageType: options.pageType ?? null,
  });
  if (checks.has('focus-visible')) {
    result.violations.push(...await focusViolations(page, options.maxFocusSteps ?? 40));
  }
  return result;
}

/**
 * Runs {@link auditPage} over widths × themes. `open(page, { width, theme })` navigates (and may
 * open overlays); it is called before every audit.
 */
export async function runLayoutAudit(page, { open, widths = AUDIT_WIDTHS, themes = AUDIT_THEMES, setTheme = setConsoleTheme, height = 900, ...options }) {
  const runs = [];
  for (const theme of themes) {
    for (const width of widths) {
      await page.setViewportSize({ width, height });
      await open(page, { width, theme });
      await setTheme(page, theme);
      runs.push(await auditPage(page, options));
    }
  }
  return { runs, violations: runs.flatMap((run) => run.violations.map((violation) => ({ ...violation, width: run.width, theme: run.theme }))) };
}

/** Human-readable summary, grouped by check. */
export function formatAuditReport(report) {
  const violations = report.violations ?? [];
  if (!violations.length) return 'layout audit: no violations';
  const byCheck = new Map();
  for (const violation of violations) {
    const list = byCheck.get(violation.check) ?? [];
    list.push(violation);
    byCheck.set(violation.check, list);
  }
  const lines = [`layout audit: ${violations.length} violation(s)`];
  for (const [check, list] of byCheck) {
    lines.push(`  ${check} (${list.length})`);
    for (const violation of list.slice(0, 20)) {
      lines.push(`    [${violation.theme ?? '-'} ${violation.width ?? '-'}px] ${violation.target ?? ''} — ${violation.message}`);
    }
    if (list.length > 20) lines.push(`    … ${list.length - 20} more`);
  }
  return lines.join('\n');
}

async function focusViolations(page, maxSteps) {
  const violations = [];
  const seen = new Set();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let step = 0; step < maxSteps; step += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const ignored = element.closest('[data-zhin-ui-ignore]')?.getAttribute('data-zhin-ui-ignore') ?? '';
      const style = getComputedStyle(element);
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      const ring = style.boxShadow !== 'none';
      const describe = element.tagName.toLowerCase() + (element.id ? `#${element.id}` : '')
        + (element.getAttribute('aria-label') ? `[aria-label="${element.getAttribute('aria-label')}"]` : '')
        + (element.textContent?.trim() ? ` "${element.textContent.trim().slice(0, 30)}"` : '');
      return { key: describe + element.getBoundingClientRect().top, describe, visible: outline || ring, ignored };
    });
    if (!state) break;
    if (seen.has(state.key)) break;
    seen.add(state.key);
    if (!state.visible && !/\bfocus-visible\b/u.test(state.ignored)) {
      violations.push({ check: 'focus-visible', target: state.describe, selector: state.describe, message: 'no visible focus style (outline or ring)' });
    }
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  return violations;
}

/* ───────────────────────── browser side (serialized by page.evaluate) ───────────────────────── */

function collect({ scale, checks, contentSelector, pageType }) {
  const enabled = new Set(checks);
  const violations = [];
  const exemptions = [];
  const root = document.documentElement;
  const remPx = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
  const px = (value) => {
    const text = String(value).trim();
    if (text.endsWith('rem')) return Number.parseFloat(text) * remPx;
    return Number.parseFloat(text);
  };
  const width = window.innerWidth;
  const height = window.innerHeight;
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  const inSet = (value, set) => set.some((entry) => near(value, entry));

  // Probe resolved values of a few semantic tokens and the elevations (theme-dependent strings).
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  const resolve = (property, value) => {
    probe.style.setProperty(property, value);
    const computed = getComputedStyle(probe).getPropertyValue(property);
    probe.style.removeProperty(property);
    return computed;
  };
  const shadows = new Set(['none', ...[1, 2, 3].map((level) => resolve('box-shadow', `var(--console-elevation-${level})`))]);
  probe.remove();

  const spacing = [0, 1, ...scale.space.map(px)];
  const pagePadding = px(getComputedStyle(root).getPropertyValue('--console-page-padding-inline')) || null;
  const radii = scale.radius.map(px);
  const borders = [0, ...scale.border.map(px)];
  const fontSizes = scale.text.map(px);
  const weights = scale.weight.map(Number);
  const touch = px(scale.touchTarget);

  const describe = (element) => {
    let text = element.tagName.toLowerCase();
    if (element.id) text += `#${element.id}`;
    const slot = element.getAttribute('data-slot');
    if (slot) text += `[data-slot=${slot}]`;
    const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/u).filter(Boolean) : [];
    const cls = classes.find((name) => name.startsWith('console-')) ?? classes[0];
    if (cls) text += `.${cls}`;
    const label = element.getAttribute('aria-label') || (element.childElementCount === 0 ? element.textContent?.trim() : '');
    if (label) text += ` "${label.slice(0, 32)}"`;
    return text;
  };
  const ignoredFor = (element, check) => {
    const holder = element.closest('[data-zhin-ui-ignore]');
    if (!holder) return false;
    const spec = holder.getAttribute('data-zhin-ui-ignore') ?? '';
    const [list, ...reason] = spec.split(':');
    const names = list.split(',').map((name) => name.trim());
    if (!names.includes(check) && !names.includes('*')) return false;
    exemptions.push({ check, target: describe(holder), selector: describe(holder), reason: reason.join(':').trim() });
    return true;
  };
  const report = (check, element, message) => {
    if (!enabled.has(check)) return;
    if (element && ignoredFor(element, check)) return;
    const target = element ? describe(element) : 'page';
    violations.push({ check, target, selector: target, message });
  };

  const hidden = (element) => {
    if (element.closest('[aria-hidden="true"], [hidden], template')) return true;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return true;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return true;
    return false;
  };
  const srOnlySelf = (element) => {
    const style = getComputedStyle(element);
    return (style.position === 'absolute' && (style.clip !== 'auto' || style.clipPath.startsWith('inset(50%'))) || (element.getBoundingClientRect().width <= 1 && element.getBoundingClientRect().height <= 1);
  };
  // Visually hidden itself or inside a visually hidden ancestor (e.g. the header row of a table in
  // card mode, whose sort buttons stay in the accessibility tree but are not on screen).
  const srCache = new Map();
  const srOnly = (element) => {
    if (!element || element === document.body) return false;
    if (srCache.has(element)) return srCache.get(element);
    const value = srOnlySelf(element) || srOnly(element.parentElement);
    srCache.set(element, value);
    return value;
  };

  const elements = [...document.body.querySelectorAll('*')].filter((element) =>
    !(element instanceof SVGElement && element.tagName.toLowerCase() !== 'svg')
    && !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'BR'].includes(element.tagName)
    && !hidden(element));

  // ── overflow ──
  if (root.scrollWidth > width + 1) {
    report('overflow', null, `page scrolls horizontally (scrollWidth ${root.scrollWidth}px > viewport ${width}px)`);
  }
  const clippedByAncestor = (element) => {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return true;
    }
    return false;
  };

  const fontSizeSet = new Set();
  const weightSet = new Set();
  const groups = new Map();
  const texts = new Map();
  const content = document.querySelector(contentSelector);
  const type = pageType ?? content?.getAttribute('data-width') ?? 'data';

  for (const element of elements) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const isSvg = element instanceof SVGElement;
    const directText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').replace(/\s+/gu, ' ').trim();
    const sr = srOnly(element);

    // type scale
    if (directText && !sr && !isSvg) {
      const size = px(style.fontSize);
      const weight = Number(style.fontWeight);
      fontSizeSet.add(size);
      weightSet.add(weight);
      if (!inSet(size, fontSizes)) report('type-scale', element, `font-size ${style.fontSize} is not on the type scale`);
      if (!weights.includes(weight)) report('type-scale', element, `font-weight ${style.fontWeight} is not regular / medium / strong`);
      if (directText.length >= 16 && !element.closest('[role="listbox"], [role="menu"], pre, code')) {
        const list = texts.get(directText) ?? [];
        list.push(element);
        texts.set(directText, list);
      }
      // contrast
      if (enabled.has('contrast')) checkContrast(element, style, size, weight);
    }
    if (isSvg) continue;

    // spacing
    const spacingSet = pagePadding ? [...spacing, pagePadding] : spacing;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const value = px(style.getPropertyValue(`padding-${side}`));
      if (!inSet(value, spacingSet)) report('spacing', element, `padding-${side} ${value}px is not on the space scale`);
    }
    if (/flex|grid/u.test(style.display)) {
      for (const property of ['row-gap', 'column-gap']) {
        const raw = style.getPropertyValue(property);
        if (raw === 'normal') continue;
        const value = px(raw);
        if (!inSet(value, spacingSet)) report('spacing', element, `${property} ${value}px is not on the space scale`);
      }
    }

    // radius
    const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) => style.getPropertyValue(`border-${corner}-radius`));
    for (const corner of corners) {
      const value = px(corner.split(' ')[0]);
      if (value >= 1000 || value >= Math.min(rect.width, rect.height) / 2 && value >= radii[radii.length - 2]) continue;
      if (!inSet(value, radii)) report('radius', element, `border-radius ${corner} is not r-0 … r-4 / full`);
    }

    // border widths
    const borderWidths = ['top', 'right', 'bottom', 'left'].map((side) => (style.getPropertyValue(`border-${side}-style`) === 'none' ? 0 : px(style.getPropertyValue(`border-${side}-width`))));
    for (const value of borderWidths) {
      if (!inSet(value, borders)) report('border', element, `border-width ${value}px is not hairline / focus`);
    }

    // shadow
    if (!shadows.has(style.boxShadow)) report('shadow', element, `box-shadow "${style.boxShadow}" is not e-0 … e-3`);

    // consistency
    const slot = element.getAttribute('data-slot');
    if (slot) {
      let key = slot;
      if (element.parentElement?.closest(`[data-slot="${slot}"]`)) key += ':nested';
      if (element.hasAttribute('data-edge')) key += ':edge';
      if (element.hasAttribute('data-interactive')) key += ':interactive';
      const signature = `radius ${corners.join(' / ')}; border ${borderWidths.join(' ')}; shadow ${style.boxShadow}`;
      const group = groups.get(key) ?? new Map();
      if (!group.has(signature)) group.set(signature, element);
      groups.set(key, group);
    }

    // static cards
    if ((slot === 'card' || slot === 'stat-card') && !element.hasAttribute('data-interactive') && style.boxShadow !== 'none') {
      report('static-card', element, 'a static card has a shadow (D16: e-0, hairline)');
    }

    // edge cards at phone width
    if (width < px(scale.breakpointSm) && slot === 'card') {
      const spans = rect.left <= 0.5 && rect.right >= width - 0.5;
      if ((spans || element.hasAttribute('data-edge')) && corners.some((corner) => px(corner) > 0.5)) {
        report('edge-card', element, 'an edge-to-edge card has rounded corners');
      }
    }

    // out of viewport
    if (!sr && (rect.right > width + 1 || rect.left < -1) && !clippedByAncestor(element) && style.position !== 'fixed') {
      report('overflow', element, `element leaves the viewport (left ${Math.round(rect.left)}px, right ${Math.round(rect.right)}px)`);
    }

    // touch targets at phone width
    if (width < px(scale.breakpointSm) && isInteractive(element) && !sr) {
      const hit = hitArea(element, rect);
      if (hit.width < touch - 0.5 || hit.height < touch - 0.5) {
        report('touch-target', element, `touch target ${Math.round(hit.width)}×${Math.round(hit.height)}px < 44×44px`);
      }
    }

    // shell overlap: content must not cover the shell
    if (content && content.contains(element) && element !== content) {
      if (style.position === 'fixed') report('shell-overlap', element, 'page content uses position: fixed');
      const z = Number.parseInt(style.zIndex, 10);
      if (Number.isFinite(z) && z > 20) report('shell-overlap', element, `page content uses z-index ${z} (> 20)`);
    }

    // bottom drawers at phone width
    if (width < px(scale.breakpointSm) && (slot === 'popover' || slot === 'dialog') && !element.parentElement?.closest('[data-slot="popover"], [data-slot="dialog"]')) {
      if (!(rect.bottom >= height - 1 && rect.left <= 1 && rect.right >= width - 1)) {
        report('bottom-drawer', element, `${slot} is not a bottom drawer (left ${Math.round(rect.left)}, right ${Math.round(rect.right)}, bottom ${Math.round(rect.bottom)} of ${height})`);
      }
    }
  }

  if (fontSizeSet.size > 5) report('type-scale', null, `${fontSizeSet.size} font sizes on the page (at most 5): ${[...fontSizeSet].sort((a, b) => a - b).join(', ')}px`);
  if (weightSet.size > 3) report('type-scale', null, `${weightSet.size} font weights on the page (at most 3): ${[...weightSet].join(', ')}`);

  for (const [key, group] of groups) {
    if (group.size > 1) {
      const variants = [...group.keys()];
      report('consistency', group.values().next().value, `${group.size} different ${key} styles at ${width}px: ${variants.join(' | ')}`);
    }
  }

  for (const [text, list] of texts) {
    if (list.length > 1) report('duplicate-text', list[1], `"${text.slice(0, 60)}" appears ${list.length} times`);
  }

  // content width
  if (content && enabled.has('content-width')) {
    const contentWidth = content.getBoundingClientRect().width;
    if (type === 'data' && width >= 1920 && contentWidth < width * 0.85) {
      report('content-width', content, `data page content is ${Math.round(contentWidth)}px, < 85% of ${width}px`);
    }
    if (type === 'reading' && contentWidth > px(scale.readingWidth) + 0.5) {
      report('content-width', content, `reading page content is ${Math.round(contentWidth)}px, > 60rem`);
    }
  }

  return { width, height, theme: root.classList.contains('dark') ? 'dark' : 'light', violations, exemptions };

  function isInteractive(element) {
    if (element.closest('[inert]')) return false;
    const tag = element.tagName;
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return true;
    if (tag === 'INPUT') return element.type !== 'hidden';
    if (tag === 'A') return element.hasAttribute('href') && !element.closest('p, li');
    const role = element.getAttribute('role');
    return ['button', 'checkbox', 'switch', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'combobox', 'link'].includes(role ?? '');
  }

  function hitArea(element, rect) {
    let best = { width: rect.width, height: rect.height };
    for (const pseudo of ['::after', '::before']) {
      const style = getComputedStyle(element, pseudo);
      if (style.content === 'none' || style.content === 'normal' || style.display === 'none') continue;
      const w = px(style.width);
      const h = px(style.height);
      if (Number.isFinite(w) && Number.isFinite(h)) best = { width: Math.max(best.width, w), height: Math.max(best.height, h) };
    }
    // A label wrapping the control is its hit area too.
    const label = element.closest('label');
    if (label) {
      const box = label.getBoundingClientRect();
      best = { width: Math.max(best.width, box.width), height: Math.max(best.height, box.height) };
    }
    return best;
  }

  function checkContrast(element, style, size, weight) {
    for (let node = element; node; node = node.parentElement) {
      if (Number(getComputedStyle(node).opacity) < 1) return; // disabled / decorative
      if (node.matches?.(':disabled, [data-disabled], [aria-disabled="true"]')) return;
    }
    const foreground = rgba(style.color);
    const background = backgroundOf(element);
    if (!foreground || !background) return;
    const text = blend(foreground, background);
    const ratio = contrast(text, background);
    const large = size >= 24 || (size >= 18.66 && weight >= 600);
    const needed = large ? 3 : 4.5;
    if (ratio < needed - 0.01) report('contrast', element, `contrast ${ratio.toFixed(2)} < ${needed} (${style.color} on ${background.join(',')})`);
  }

  function backgroundOf(element) {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none') return null; // gradients / images: not judged
      const color = rgba(style.backgroundColor);
      if (color && color[3] > 0) {
        layers.push(color);
        if (color[3] >= 1) break;
      }
    }
    let base = [255, 255, 255, 1];
    for (const layer of layers.reverse()) base = blend(layer, base);
    return base;
  }

  function rgba(color) {
    const canvas = rgba.canvas ?? (rgba.canvas = document.createElement('canvas'));
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = '#000';
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  }

  function blend(top, bottom) {
    const alpha = top[3];
    return [0, 1, 2].map((index) => top[index] * alpha + bottom[index] * (1 - alpha)).concat(1);
  }

  function contrast(a, b) {
    const luminance = (color) => {
      const [r, g, b2] = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    };
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
}
