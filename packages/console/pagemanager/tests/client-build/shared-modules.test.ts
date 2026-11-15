import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';
import { CONSOLE_SHARED_MODULES_KEY } from '@zhin.js/contract';
import { TypeScriptClientBuilder } from '../../src/client-build/index.js';
import {
  ALLOWED_ESM_CANONICAL,
  CONSOLE_SHARED_MODULE_ISSUE_EVENT,
  CONSOLE_SHARED_MODULE_ISSUES_KEY,
  CONSOLE_SHARED_MODULE_VERSIONS_KEY,
  CONSOLE_UI_MODULE,
  buildHostProxyModule,
  classifySharedModuleVersion,
  compilePeerRange,
  getOrBuildCanonicalEsmBundle,
  importedNames,
  peerRangeForPage,
  rewriteBareImportsForBrowser,
  sharedModuleQuery,
  sharedModuleRequestFromSearchParams,
} from '../../src/node/index.js';

const temporary: string[] = [];
const globals = globalThis as Record<string, unknown>;

afterEach(async () => {
  delete globals[CONSOLE_SHARED_MODULES_KEY];
  delete globals[CONSOLE_SHARED_MODULE_VERSIONS_KEY];
  delete globals[CONSOLE_SHARED_MODULE_ISSUES_KEY];
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-shared-modules-'));
  temporary.push(root);
  return root;
}

let moduleCounter = 0;
async function evaluate(code: string): Promise<Record<string, unknown>> {
  // Unique suffix: data: URL modules are cached by URL.
  const source = `${code}\n// ${moduleCounter++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) as Promise<Record<string, unknown>>;
}

function registerHost(version: string | undefined, module: Record<string, unknown>): void {
  globals[CONSOLE_SHARED_MODULES_KEY] = new Map([[CONSOLE_UI_MODULE, module]]);
  if (version !== undefined) globals[CONSOLE_SHARED_MODULE_VERSIONS_KEY] = new Map([[CONSOLE_UI_MODULE, version]]);
}

function proxy(range: string | undefined, names: string[]): string {
  return buildHostProxyModule(CONSOLE_UI_MODULE, names, undefined, [], {
    request: { ...(range ? { range } : {}), consumer: '@zhin.js/plugin-rss', imports: names },
  });
}

describe('peer range compilation and the browser-side version check', () => {
  it.each([
    ['^0.1.0', '0.1.0', 'ok'],
    ['^0.1.0', '0.1.9', 'ok'],
    ['^0.2.0', '0.1.5', 'minor'],
    ['^0.1.0', '0.2.0', 'range'],
    ['^0.1.0', '1.0.0', 'major'],
    ['^1.2.0', '1.1.0', 'minor'],
    ['^1.2.0', '1.9.0', 'ok'],
    ['^1.2.0', '2.0.0', 'major'],
    ['~1.2.3', '1.2.9', 'ok'],
    ['~1.2.3', '1.3.0', 'range'],
    ['>=1.0.0 <3', '2.4.0', 'ok'],
    ['>=1.0.0 <3', '3.0.0', 'major'],
    ['1.x || 3.x', '2.0.0', 'major'],
    ['1.x || 3.x', '3.1.0', 'ok'],
    ['1.0.0 - 1.4', '1.4.9', 'ok'],
    ['1.0.0 - 1.4', '1.5.0', 'range'],
    ['>= 0.3', '0.2.0', 'minor'],
    ['*', '9.9.9', 'ok'],
    ['^0.1.0', '0.1.0-beta.1', 'ok'],
  ])('%s with host %s → %s', (range, host, verdict) => {
    expect(classifySharedModuleVersion(host, range)).toBe(verdict);
  });

  it('gives up on ranges it cannot read', () => {
    expect(compilePeerRange('latest')).toBeUndefined();
    expect(compilePeerRange('workspace:^')).toBeUndefined();
    expect(compilePeerRange('')).toBeUndefined();
    expect(compilePeerRange('^0.1.0')).toMatchObject({ range: '^0.1.0', majors: [[0, 0]] });
  });
});

describe('versioned proxy module for @zhin.js/console-ui', () => {
  it('serves the Console copy when the range is met and reports missing exports by name', async () => {
    const Button = () => 'button';
    registerHost('0.1.2', { Button });
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    globalThis.addEventListener?.(CONSOLE_SHARED_MODULE_ISSUE_EVENT, listener);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const mod = await evaluate(proxy('^0.1.0', ['Button', 'RefreshControl']));
      expect(mod.Button).toBe(Button);
      expect(() => (mod.RefreshControl as () => unknown)()).toThrow('@zhin.js/console-ui@0.1.2 does not export "RefreshControl" (needed by @zhin.js/plugin-rss, built for ^0.1.0)');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('is missing exports RefreshControl needed by @zhin.js/plugin-rss'));
      expect(globals[CONSOLE_SHARED_MODULE_ISSUES_KEY]).toEqual([
        expect.objectContaining({ kind: 'export', module: CONSOLE_UI_MODULE, missingExports: ['RefreshControl'], hostVersion: '0.1.2', range: '^0.1.0', consumer: '@zhin.js/plugin-rss' }),
      ]);
      if (globalThis.addEventListener) expect(events).toHaveLength(1);
    } finally {
      globalThis.removeEventListener?.(CONSOLE_SHARED_MODULE_ISSUE_EVENT, listener);
    }
  });

  it('refuses an incompatible major version with a clear error', async () => {
    registerHost('1.0.0', { Button: () => null });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(evaluate(proxy('^0.1.0', ['Button']))).rejects.toThrow(
      '@zhin.js/plugin-rss needs @zhin.js/console-ui ^0.1.0, but the Console provides 1.0.0 (incompatible major version)',
    );
    expect(globals[CONSOLE_SHARED_MODULE_ISSUES_KEY]).toEqual([expect.objectContaining({ kind: 'major' })]);
  });

  it('warns and records an issue when the Console copy is an older minor', async () => {
    registerHost('0.1.0', { Button: () => null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mod = await evaluate(proxy('^0.2.0', ['Button']));
    expect(typeof mod.Button).toBe('function');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('provides the older 0.1.0'));
    expect(globals[CONSOLE_SHARED_MODULE_ISSUES_KEY]).toEqual([expect.objectContaining({ kind: 'minor', range: '^0.2.0', hostVersion: '0.1.0' })]);
  });

  it('notes a Console that shares the module without registering its version', async () => {
    registerHost(undefined, { Button: () => null });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await evaluate(proxy('^0.1.0', ['Button']));
    expect(globals[CONSOLE_SHARED_MODULE_ISSUES_KEY]).toEqual([expect.objectContaining({ kind: 'unversioned' })]);
  });

  it('skips the range check without a peer range', async () => {
    registerHost('5.0.0', { Button: () => null });
    const mod = await evaluate(proxy(undefined, ['Button']));
    expect(typeof mod.Button).toBe('function');
    expect(globals[CONSOLE_SHARED_MODULE_ISSUES_KEY]).toBeUndefined();
  });

  it('keeps the previous proxy shape for unversioned modules (React)', () => {
    const code = buildHostProxyModule('react', ['useState']);
    expect(code).toContain('export const useState = _m.useState ?? _def?.useState;');
    expect(code).not.toContain('_zhinCheckSharedVersion');
  });

  it('serves a per-page proxy through getOrBuildCanonicalEsmBundle', async () => {
    const code = await getOrBuildCanonicalEsmBundle(CONSOLE_UI_MODULE, await temp(), '/', {
      range: '^0.1.0',
      consumer: '@zhin.js/plugin-rss',
      imports: ['Button'],
    });
    expect(code).toContain('"range":"^0.1.0"');
    expect(code).toContain('export const Button = _has("Button")');
  });
});

describe('page bundles and /esm URLs', () => {
  it('shares @zhin.js/console-ui like React (never bundled into a plugin)', () => {
    expect(ALLOWED_ESM_CANONICAL.has(CONSOLE_UI_MODULE)).toBe(true);
  });

  it('round-trips the page request through the /esm query string', () => {
    const query = sharedModuleQuery({ range: '^0.1.0', consumer: '@zhin.js/plugin-rss', imports: ['Card', 'Button', 'Button', 'bad-name'] });
    expect(query).toBe('&peer=%5E0.1.0&consumer=%40zhin.js%2Fplugin-rss&imports=Button%2CCard');
    expect(sharedModuleRequestFromSearchParams(new URLSearchParams(`v=1${query}`))).toEqual({
      range: '^0.1.0',
      consumer: '@zhin.js/plugin-rss',
      imports: ['Button', 'Card'],
    });
    expect(sharedModuleRequestFromSearchParams(new URLSearchParams('v=1'))).toBeUndefined();
    const rewritten = rewriteBareImportsForBrowser('import { Button } from "@zhin.js/console-ui";', '/', '', {
      sharedModules: { [CONSOLE_UI_MODULE]: { range: '^0.1.0', imports: ['Button'] } },
    });
    expect(rewritten).toMatch(/from "\/esm\/%40zhin\.js~console-ui\.mjs\?v=[a-z0-9]+&peer=%5E0\.1\.0&imports=Button"/u);
  });

  it('reads the named imports of a bundle', () => {
    const code = [
      'import { Button, Card as C } from "@zhin.js/console-ui";',
      'import UI, { Table } from "@zhin.js/console-ui";',
      'export { Badge } from "@zhin.js/console-ui";',
      'import { useState } from "react";',
    ].join('\n');
    expect(importedNames(code, CONSOLE_UI_MODULE)).toEqual(['Badge', 'Button', 'Card', 'Table']);
  });

  it('takes the peer range from the page package and resolves workspace:^ to the installed version', async () => {
    const root = await temp();
    const pluginDir = join(root, 'plugins/rss');
    await mkdir(join(pluginDir, 'pages/feeds'), { recursive: true });
    await mkdir(join(root, 'node_modules/@zhin.js/console-ui'), { recursive: true });
    await writeFile(join(root, 'node_modules/@zhin.js/console-ui/package.json'), JSON.stringify({ name: CONSOLE_UI_MODULE, version: '0.1.4' }));
    const page = join(pluginDir, 'pages/feeds/index.tsx');
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: '@zhin.js/plugin-rss', peerDependencies: { [CONSOLE_UI_MODULE]: 'workspace:^' } }));
    expect(peerRangeForPage(page, CONSOLE_UI_MODULE, root)).toEqual({ range: '^0.1.4', consumer: '@zhin.js/plugin-rss' });
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: '@zhin.js/plugin-rss', peerDependencies: { [CONSOLE_UI_MODULE]: '^0.2.0' } }));
    expect(peerRangeForPage(page, CONSOLE_UI_MODULE, root)).toEqual({ range: '^0.2.0', consumer: '@zhin.js/plugin-rss' });
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: '@zhin.js/plugin-rss' }));
    expect(peerRangeForPage(page, CONSOLE_UI_MODULE, root)).toEqual({ consumer: '@zhin.js/plugin-rss' });
  });

  it('builds a .tsx page that imports @zhin.js/console-ui into a Host-proxied import carrying the peer range', async () => {
    const root = await temp();
    const pluginDir = join(root, 'plugins/rss');
    const source = join(pluginDir, 'pages/feeds/index.tsx');
    await mkdir(dirname(source), { recursive: true });
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: '@zhin.js/plugin-rss', peerDependencies: { [CONSOLE_UI_MODULE]: '^0.1.0' } }));
    await writeFile(source, [
      "import { definePage } from '@zhin.js/console-contract';",
      "import { Button, cn } from '@zhin.js/console-ui';",
      "import { cn as cn2 } from '@zhin.js/console-ui/cn';",
      "import '@zhin.js/console-ui/styles.css';",
      "export const meta = definePage({ title: 'Feeds', keywords: { 'zh-CN': ['订阅'], en: ['rss'] } });",
      'export default function Feeds() { return <Button className={cn("a", cn2("b"))}>Feeds</Button>; }',
    ].join('\n'));
    const builder = new TypeScriptClientBuilder({ projectRoot: root, outDir: join(root, 'dist') });
    const request: ClientModuleRequest = { feature: 'zhin.page' as never, owner: 'root' as never, localName: 'feeds' };
    const artifact = await builder.load<{ module: string; metadata: unknown }>(source, request);
    expect(artifact.metadata).toMatchObject({ keywords: { 'zh-CN': ['订阅'], en: ['rss'] } });
    const chunk = await readFile(join(root, 'dist', artifact.module.split('/').at(-1)!), 'utf8');
    expect(chunk).not.toMatch(/from\s*["']@zhin\.js\/console-ui/u);
    expect(chunk).toMatch(/from "\/esm\/%40zhin\.js~console-ui\.mjs\?v=[a-z0-9]+&peer=%5E0\.1\.0&consumer=%40zhin\.js%2Fplugin-rss&imports=Button%2Ccn"/u);
    expect(chunk).not.toContain('styles.css');

    // The register wrapper puts keywords into the route meta the Console reads.
    const runnable = chunk
      .replace(/(["'])\/esm\/react(?:%7E|~)jsx-runtime\.mjs(?:\?[^"']*)?\1/gu, JSON.stringify('data:text/javascript,export const jsx=()=>null;export const jsxs=jsx;'))
      .replace(/(["'])\/esm\/%40zhin\.js~console-ui\.mjs(?:\?[^"']*)?\1/gu, JSON.stringify('data:text/javascript,export const Button=()=>null;export const cn=(...a)=>a.join(" ");'));
    const browserModule = await import(`data:text/javascript;base64,${Buffer.from(runnable).toString('base64')}`);
    const routes: { meta?: Record<string, unknown> }[] = [];
    browserModule.register({ React: { createElement: (...args: unknown[]) => args }, addRoute: (route: { meta?: Record<string, unknown> }) => routes.push(route), addTool: () => 'feeds' });
    expect(routes[0]?.meta).toMatchObject({ keywords: { 'zh-CN': ['订阅'], en: ['rss'] } });
  });

  it('uses the same global keys as @zhin.js/console-ui', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../ui/client/shared-module.ts'), 'utf8');
    expect(source).toContain(`CONSOLE_SHARED_MODULE_VERSIONS_KEY = '${CONSOLE_SHARED_MODULE_VERSIONS_KEY}'`);
    expect(source).toContain(`CONSOLE_SHARED_MODULE_ISSUES_KEY = '${CONSOLE_SHARED_MODULE_ISSUES_KEY}'`);
    expect(source).toContain(`CONSOLE_SHARED_MODULE_ISSUE_EVENT = '${CONSOLE_SHARED_MODULE_ISSUE_EVENT}'`);
    expect(source).toContain(`CONSOLE_UI_MODULE_ID = '${CONSOLE_UI_MODULE}'`);
  });
});
