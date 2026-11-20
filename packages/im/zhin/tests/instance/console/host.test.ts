import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { TokenRegistry, type HttpHandler } from '@zhin.js/host-http';
import {
  createConsoleHostModules,
  registerConsoleHttp,
} from '../../../src/instance/console/host.js';
import { projectConsoleEntries } from '../../../src/instance/console/entry-projection.js';
import { registerConsoleEntryRoutes } from '../../../src/instance/console/entry-routes.js';

const call = (handler: HttpHandler, url: string) => {
  const parsed = new URL(url);
  return Promise.resolve(handler(new Request(parsed), { url: parsed, params: {} }));
};

describe('Console topology Host endpoint', () => {
  it('loads and reloads server TSX through the CLI fallback loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-cli-tsx-'));
    const source = join(root, 'commands/hello/index.tsx');
    const jsxPackage = join(root, 'node_modules/test-jsx');
    await mkdir(join(root, 'commands/hello'), { recursive: true });
    await mkdir(jsxPackage, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'test-jsx' },
    }));
    await writeFile(join(jsxPackage, 'package.json'), JSON.stringify({
      type: 'module',
      exports: {
        './jsx-runtime': './jsx-runtime.js',
        './jsx-dev-runtime': './jsx-runtime.js',
      },
    }));
    await writeFile(
      join(jsxPackage, 'jsx-runtime.js'),
      'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const jsxDEV=jsx;export const Fragment=Symbol();\n',
    );
    const host = createConsoleHostModules(root, false);
    try {
      await writeFile(source, 'export default <message value={1}>hello</message>;\n');
      expect((await host.modules.load<{ default: { props: { value: number } } }>(source)).default.props.value)
        .toBe(1);

      await writeFile(source, 'export default <message value={2}>hello</message>;\n');
      host.modules.invalidate?.(source);
      expect((await host.modules.load<{ default: { props: { value: number } } }>(source)).default.props.value)
        .toBe(2);
    } finally {
      await host.modules.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes a route resolution from one Console topology view', async () => {
    const route = vi.fn();
    const topology = Object.freeze({
      generation: 12,
      pages: Object.freeze([{ id: 'status', route: '/a/p-status', title: 'Status' }]),
      navigation: Object.freeze([{ type: 'page', label: 'Status', route: '/a/p-status' }]),
      resolve: (path: string) => Object.freeze({
        status: 'found' as const,
        page: { id: 'status', route: path, title: 'Status' },
        layouts: { nav: { module: '/a-nav-v12.js' }, footer: { module: '/root-footer-v12.js' } },
      }),
    });
    const consoleRuntime = {
      runView: async (_access: unknown, operation: (catalog: { topology: () => typeof topology }) => unknown) =>
        operation({ topology: () => topology }),
    } as unknown as ConsoleRuntime;
    registerConsoleHttp({
      http: { route, tokenRegistry: new TokenRegistry() } as never,
      console: consoleRuntime,
      clientOutDir: '/tmp/client',
      projectRoot: '/tmp/project',
    });

    const handler = route.mock.calls.find((call) => call[1] === '/console/api/topology')?.[2] as HttpHandler;
    const response = await call(handler, 'http://localhost/console/api/topology?route=/a/p-status');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      generation: 12,
      pages: [{ id: 'status', route: '/a/p-status', title: 'Status' }],
      navigation: [{ type: 'page', label: 'Status', route: '/a/p-status' }],
      route: '/a/p-status',
      resolution: {
        status: 'found',
        page: { id: 'status', route: '/a/p-status', title: 'Status' },
        layouts: { nav: { module: '/a-nav-v12.js' }, footer: { module: '/root-footer-v12.js' } },
      },
    });
  });
  it('resolves a page route while the Console view lease is still active', async () => {
    const route = vi.fn();
    let active = false;
    const assertActive = () => {
      if (!active) throw new Error('Console catalog view scope has ended');
    };
    const page = { id: 'sandbox', route: '/sandbox', title: 'Sandbox' };
    const consoleRuntime = {
      runView: async (_access: unknown, operation: (catalog: unknown) => unknown) => {
        active = true;
        try {
          return await operation({
            topology: () => {
              assertActive();
              return Object.freeze({
                generation: 1,
                pages: Object.freeze([page]),
                navigation: Object.freeze([]),
                resolve: (path: string) => {
                  assertActive();
                  return path === '/sandbox'
                    ? Object.freeze({ status: 'found' as const, page, layouts: {} })
                    : Object.freeze({ status: 'missing' as const });
                },
              });
            },
          });
        } finally {
          active = false;
        }
      },
    } as unknown as ConsoleRuntime;
    registerConsoleHttp({
      http: { route, tokenRegistry: new TokenRegistry() } as never,
      console: consoleRuntime,
      clientOutDir: '/tmp/client',
      projectRoot: '/tmp/project',
    });

    const handler = route.mock.calls.find((call) => call[1] === '/*')?.[2] as HttpHandler;
    expect((await call(handler, 'http://localhost/sandbox')).status).toBe(200);
    expect((await call(handler, 'http://localhost/nope')).status).toBe(404);
  });

  it('projects Console entries with rich PageMetadata and locale title resolution across GET /entries and GET /pages', async () => {
    const richPage = {
      id: 'root/ambient:ambient',
      localName: 'ambient',
      route: '/ambient',
      title: '群潜望',
      titleI18n: { 'zh-CN': '群潜望', en: 'Ambient Insights' },
      description: 'Ambient group radar',
      icon: 'Radar',
      group: 'Agent',
      order: 10,
      parent: 'overview',
      fullWidth: true,
      section: 'conversations',
      keywords: { 'zh-CN': ['群聊雷达'], en: ['radar'] },
      packageName: '@zhin.js/plugin-ambient',
      pluginDescription: 'Ambient group insights',
      hideInNav: false,
      module: '/assets/client/ambient.js',
      owner: 'root/ambient' as never,
      source: '/app/ambient/pages/ambient/index.tsx',
      requiredPermissions: ['ambient:read'],
      requiredRoles: ['member'],
    };

    const projected = projectConsoleEntries([richPage], { locale: 'en' });
    expect(projected.entries[0]).toMatchObject({
      id: 'ambient',
      name: 'ambient',
      title: 'Ambient Insights',
      titleI18n: { 'zh-CN': '群潜望', en: 'Ambient Insights' },
      description: 'Ambient group radar',
      icon: 'Radar',
      group: 'Agent',
      order: 10,
      parent: 'overview',
      fullWidth: true,
      section: 'conversations',
      keywords: { 'zh-CN': ['群聊雷达'], en: ['radar'] },
      packageName: '@zhin.js/plugin-ambient',
      pluginDescription: 'Ambient group insights',
      meta: expect.objectContaining({ keywords: { 'zh-CN': ['群聊雷达'], en: ['radar'] } }),
      hideInNav: false,
      owner: 'root/ambient',
      requiredPermissions: ['ambient:read'],
      requiredRoles: ['member'],
    });

    const route = vi.fn();
    const consoleRuntime = {
      runView: async (_access: unknown, operation: (catalog: unknown) => unknown) =>
        operation({
          pages: () => [richPage],
          topology: () => ({
            generation: 1,
            pages: [richPage],
            navigation: [],
            resolve: () => ({ status: 'missing' as const }),
          }),
        }),
    } as unknown as ConsoleRuntime;

    registerConsoleHttp({
      http: { route, tokenRegistry: new TokenRegistry() } as never,
      console: consoleRuntime,
      clientOutDir: '/tmp/client',
      projectRoot: '/tmp/project',
    });

    const entriesHandler = route.mock.calls.find((call) => call[1] === '/entries')?.[2] as HttpHandler;
    const entries = await call(entriesHandler, 'http://localhost/entries?locale=en');
    expect(entries.status).toBe(200);
    expect(entries.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const entriesBody = await entries.json();
    expect(entriesBody.entries[0]).toMatchObject({
      id: 'ambient',
      title: 'Ambient Insights',
      group: 'Agent',
      icon: 'Radar',
      section: 'conversations',
      keywords: { 'zh-CN': ['群聊雷达'], en: ['radar'] },
      packageName: '@zhin.js/plugin-ambient',
      pluginDescription: 'Ambient group insights',
      meta: expect.objectContaining({ section: 'conversations', keywords: { 'zh-CN': ['群聊雷达'], en: ['radar'] } }),
    });

    const pagesHandler = route.mock.calls.find((call) => call[1] === '/pages')?.[2] as HttpHandler;
    const pagesResponse = await call(pagesHandler, 'http://localhost/pages');
    expect(pagesResponse.status).toBe(200);
    expect(pagesResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await pagesResponse.text()).toContain('Ambient group radar');
  });
});

describe('Console page routes ?locale= (#1250 batch 77)', () => {
  const invalidLocale = { success: false, code: 'invalid_locale', error: 'locale 只能是 zh-CN 或 en（locale must be zh-CN or en）' };
  const page = {
    id: 'root/status:status', localName: 'status', route: '/status', title: '状态', module: '/status.js', hash: 'h1',
    titleI18n: { 'zh-CN': '运行状态', en: 'Status' },
  };
  const consoleRuntime = {
    runView: async (_access: unknown, operation: (catalog: unknown) => unknown) => operation({ pages: () => [page] }),
  } as unknown as ConsoleRuntime;
  const handlers = () => {
    const route = vi.fn();
    const http = { route, tokenRegistry: new TokenRegistry() } as never;
    registerConsoleHttp({ http, console: consoleRuntime, clientOutDir: '/tmp/client', projectRoot: '/tmp/project' });
    const hostRoutes = [...route.mock.calls];
    route.mockClear();
    registerConsoleEntryRoutes({ http, consoleRuntime });
    const handler = (calls: unknown[][], path: string) => calls.find((call) => call[1] === path)?.[2] as HttpHandler;
    return {
      'GET /entries (entry-routes)': handler(route.mock.calls, '/entries'),
      'GET /entries (host)': handler(hostRoutes, '/entries'),
      'GET /console/api/pages': handler(hostRoutes, '/console/api/pages'),
      'GET /console': handler(hostRoutes, '/console'),
      'GET /pages': handler(hostRoutes, '/pages'),
    };
  };
  const paths: Record<string, string> = {
    'GET /entries (entry-routes)': '/entries', 'GET /entries (host)': '/entries',
    'GET /console/api/pages': '/console/api/pages', 'GET /console': '/console', 'GET /pages': '/pages',
  };

  it.each(Object.keys(paths))('%s answers an unsupported or repeated locale with 400 invalid_locale', async (name) => {
    const handler = handlers()[name as keyof ReturnType<typeof handlers>];
    for (const query of ['locale=en-US', 'locale=fr', 'locale=', 'locale=en&locale=zh-CN']) {
      const response = await call(handler, `http://localhost${paths[name]}?${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(invalidLocale);
    }
  });

  it.each(Object.keys(paths))('%s keeps the untranslated title without a locale and translates a supported one', async (name) => {
    const handler = handlers()[name as keyof ReturnType<typeof handlers>];
    const absent = await call(handler, `http://localhost${paths[name]}`);
    expect(absent.status).toBe(200);
    const english = await call(handler, `http://localhost${paths[name]}?locale=en`);
    expect(english.status).toBe(200);
    if (name.startsWith('GET /entries')) {
      expect((await absent.json()).entries[0].title).toBe('状态');
      expect((await english.json()).entries[0].title).toBe('Status');
    } else if (name === 'GET /console/api/pages') {
      expect((await absent.json()).pages[0].title).toBe('状态');
      expect((await english.json()).pages[0].title).toBe('Status');
    } else {
      expect(absent.headers.get('content-type')).toBe('text/html; charset=utf-8');
    }
  });
});
