import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  createConsoleHostModules,
  installConsoleHttp,
} from '../../../src/plugin-runtime/console/host.js';

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
    installConsoleHttp({ console: consoleRuntime, clientOutDir: '/tmp/client', projectRoot: '/tmp/project' })({
      resources: {
        provide: vi.fn(),
        use: (token: unknown) => {
          expect(token).toBe(httpHostToken);
          return { route };
        },
      },
    } as never);

    const handler = route.mock.calls.find((call) => call[1] === '/console/api/topology')?.[2] as (
      request: unknown,
      response: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body?: string) => void },
      url: URL,
    ) => Promise<void>;
    const writeHead = vi.fn();
    const end = vi.fn();
    await handler({}, { writeHead, end }, new URL('http://localhost/console/api/topology?route=/a/p-status'));

    expect(writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'content-type': 'application/json; charset=utf-8',
    }));
    expect(JSON.parse(end.mock.calls[0]?.[0] as string)).toEqual({
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
});
