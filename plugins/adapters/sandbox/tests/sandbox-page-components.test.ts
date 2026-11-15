import { readdir, readFile } from 'node:fs/promises';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPageChromeStore, PageChromeProvider } from '@zhin.js/console-ui';
import { extractPageMetadata } from '@zhin.js/pagemanager/client-build';
import SandboxPage from '../pages/index/index.js';
import { workspaceStyles } from '../pages/index/workspaceStyles.js';
import { sandboxStyles } from '../pages/index/styles.js';

const pagesDir = new URL('../pages/index/', import.meta.url);
const pageSources = async () => Promise.all((await readdir(pagesDir)).filter((name) => name.endsWith('.tsx'))
  .map(async (name) => ({ name, source: await readFile(new URL(name, pagesDir), 'utf8') })));

// The convention page is compiled with the automatic JSX runtime by pagemanager; vitest uses the classic one.
(globalThis as { React?: typeof React }).React = React;

/** Splits a selector list at top-level commas (not inside `:where(...)`). */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

/** Every `<button>` of the server-rendered page with its class list. */
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>/gu)].map((match) => match[1]!);

describe('Sandbox page on @zhin.js/console-ui (ADR 0063 D13 step 2)', () => {
  it('fills the content area and leaves the header to the Console shell', async () => {
    const source = await readFile(new URL('index.tsx', pagesDir), 'utf8');
    expect(extractPageMetadata(source, new URL('index.tsx', pagesDir).pathname)).toMatchObject({ fullWidth: true });
  });

  it('uses library controls only: no native button, input, select, textarea, table, dialog or h1', async () => {
    for (const { name, source } of await pageSources()) {
      expect(source, name).not.toMatch(/<(button|input|select|textarea|table|dialog|h1)\b/u);
    }
  });

  it('keeps a solid red button for the confirmation dialog only (ADR 0063 决策 5)', async () => {
    const source = (await pageSources()).map((page) => page.source).join('\n');
    expect(source.match(/variant="destructive"/gu)).toHaveLength(1);
    expect(source).toMatch(/<ConfirmDialog[\s\S]*?variant="destructive"/u);
  });

  it('renders component-library buttons and injects its own styles', () => {
    const html = renderToStaticMarkup(createElement(SandboxPage));
    expect(html).toContain('class="zhin-sandbox agent-playground-shell"');
    // The styles travel with the page; React escapes nothing inside <style> but the text must be complete.
    expect(html).toContain('.agent-playground-shell:where(.zhin-sandbox)');
    const all = buttons(html);
    expect(all.length).toBeGreaterThan(10);
    // Button / Input carry console-control; ListItemButton rows carry its 44px tap target; tabs are Radix triggers.
    const unmanaged = all.filter((attributes) => !/console-control|max-md:min-h-11|role="tab"/u.test(attributes));
    expect(unmanaged).toEqual([]);
    expect(html).not.toMatch(/<select\b/u);
  });

  it('without a shell draws the pane toggles itself; inside a shell it hands them to the header', () => {
    const markup = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/gu, '');
    const standalone = markup(renderToStaticMarkup(createElement(SandboxPage)));
    expect(standalone).toContain('agent-playground-mobilebar');
    expect(standalone).toContain('agent-playground-brand');

    const store = createPageChromeStore();
    store.set({ actions: 'placeholder' });
    const hosted = markup(renderToStaticMarkup(createElement(PageChromeProvider, { store }, createElement(SandboxPage))));
    expect(hosted).not.toContain('agent-playground-mobilebar');
    // The shell header already says 「会话」: the workbench does not repeat the page title.
    expect(hosted).not.toContain('agent-playground-brand');
    expect(hosted).toContain('is-hosted');
  });

  it('keeps workbench element rules off the library controls', () => {
    const css = `${workspaceStyles}\n${sandboxStyles}`.replace(/\/\*[\s\S]*?\*\//gu, '');
    const selectors = [...css.matchAll(/([^{};]+)\{/gu)].map((match) => match[1]!.trim())
      .filter((list) => list && !list.startsWith('@')).flatMap(splitSelectors);
    const elementRules = selectors.filter((selector) => /(^|[\s>+~(,])(button|input|select|textarea|a)(?=[\s:.[>+~)]|$)/u.test(selector));
    expect(elementRules.length).toBeGreaterThan(20);
    expect(elementRules.filter((selector) => !selector.includes(':where(:not(.console-control, [data-state]))'))).toEqual([]);
  });

  it('never covers the Console shell: the drawers are positioned inside the workbench', () => {
    expect(sandboxStyles).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.agent-playground-sessions\.channel-sidebar \{ position: absolute;/u);
    expect(sandboxStyles).toMatch(/\.zhin-sandbox \.channel-overlay \{ position: absolute;/u);
    expect(sandboxStyles).not.toMatch(/position:\s*fixed/u);
  });

  it('declares the component library as a peer dependency', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.peerDependencies['@zhin.js/console-ui']).toBe('workspace:^');
    expect(manifest.devDependencies['@zhin.js/console-ui']).toBe('workspace:*');
  });
});
