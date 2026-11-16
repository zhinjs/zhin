import { readFile } from 'node:fs/promises';
import { workspaceStyles } from '../pages/index/workspaceStyles.js';
import { sandboxStyles } from '../pages/index/styles.js';

/** Selectors of every style rule (outside `@keyframes`), with the at-rules around them. */
function styleRules(css: string): { selector: string; atRules: string[] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const rules: { selector: string; atRules: string[] }[] = [];
  const stack: { at?: string; rule?: boolean }[] = [];
  let buffer = '';
  for (const char of text) {
    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@')) { stack.push({ at: prelude }); continue; }
      const atRules = stack.flatMap((entry) => entry.at ? [entry.at] : []);
      if (!atRules.some((at) => /^@(-webkit-)?keyframes/u.test(at))) {
        for (const selector of splitSelectors(prelude)) rules.push({ selector, atRules });
      }
      stack.push({ rule: true });
    } else if (char === '}') {
      stack.pop();
      buffer = '';
    } else if (char === ';' && stack.at(-1)?.rule) {
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return rules;
}

function splitSelectors(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of prelude) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const pageSource = () => readFile(new URL('../pages/index/SandboxChat.tsx', import.meta.url), 'utf8');

describe('Sandbox page styles (ADR 0063 D13)', () => {
  it('scopes every injected rule to the page so nothing leaks into the Console', () => {
    for (const [name, css] of Object.entries({ workspaceStyles, sandboxStyles })) {
      const rules = styleRules(css);
      expect(rules.length, name).toBeGreaterThan(50);
      const unscoped = rules.filter((rule) => !rule.selector.includes('.zhin-sandbox'));
      expect(unscoped.map((rule) => rule.selector), name).toEqual([]);
    }
  });

  it('carries its own workspace styles instead of relying on the Console stylesheet', async () => {
    const source = await pageSource();
    const css = `${workspaceStyles}\n${sandboxStyles}`;
    const styled = new Set(styleRules(css).flatMap((rule) => [...rule.selector.matchAll(/\.([A-Za-z0-9_-]+)/gu)].map((match) => match[1])));
    const used = new Set([...source.matchAll(/\b(agent-playground-[a-z0-9-]+)/gu)].map((match) => match[1]!));
    expect(used.size).toBeGreaterThan(40);
    // Class names that only carry state or are hooks for tests / aria are not expected to be styled.
    const missing = [...used].filter((name) => !styled.has(name));
    expect(missing).toEqual([]);
  });

  it('does not depend on Tailwind: no utilities, @apply or theme functions', () => {
    const css = `${workspaceStyles}\n${sandboxStyles}`;
    expect(css).not.toMatch(/@apply|@tailwind|theme\(|--tw-/u);
  });

  it('injects the moved workspace styles before its own rules, as the Console cascade had them', async () => {
    const source = await pageSource();
    const injected = source.indexOf('${workspaceStyles}');
    expect(injected).toBeGreaterThan(-1);
    expect(source.indexOf('${sandboxStyles}')).toBeGreaterThan(injected);
  });
});
