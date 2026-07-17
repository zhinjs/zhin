import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientModuleRequest } from '@zhin.js/next-feature-kit';
import type { ModuleRuntime } from '@zhin.js/next-runtime';
import {
  ClientBuildModuleRuntime,
  ClientSourceError,
  ManifestClientModuleLoader,
  TypeScriptClientBuilder,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Client build adapter', () => {
  it('extracts literal Page metadata and writes deterministic ESM plus manifest', async () => {
    const root = await temp();
    const source = join(root, 'pages/status.tsx');
    await writeSource(source, [
      "import { definePage } from '@zhin.js/next-console-contract';",
      "export const meta = definePage({ title: 'Status', order: 10, requiredRoles: ['admin'] });",
      'export default function Status() { return <main>Status</main>; }',
    ].join('\n'));
    const builder = new TypeScriptClientBuilder({
      projectRoot: root,
      outDir: join(root, 'dist/client'),
      publicBase: '/assets/zhin',
    });
    const entry = pageEntry(source);
    const manifest = await builder.build([entry]);
    const artifact = manifest.entries[0];

    expect(artifact).toMatchObject({
      owner: 'root',
      localName: 'status',
      source: 'pages/status.tsx',
      module: expect.stringMatching(/^\/assets\/zhin\/root-status-[a-f0-9]{16}\.js$/u),
      metadata: { title: 'Status', order: 10, requiredRoles: ['admin'] },
    });
    const chunk = await readFile(join(root, 'dist/client', artifact!.module.split('/').at(-1)!), 'utf8');
    expect(chunk).toContain('react/jsx-runtime');
    const persisted = JSON.parse(
      await readFile(join(root, 'dist/client/pages.manifest.json'), 'utf8'),
    ) as { protocol: number; entries: unknown[] };
    expect(persisted).toMatchObject({ protocol: 1, entries: [expect.objectContaining({ hash: artifact?.hash })] });
  });

  it('rejects dynamic metadata with a source location', async () => {
    const root = await temp();
    const source = join(root, 'pages/status.tsx');
    await writeSource(source, [
      "import { definePage } from '@zhin.js/next-console-contract';",
      'const title = process.env.TITLE;',
      'export const meta = definePage({ title });',
      'export default function Status() { return null; }',
    ].join('\n'));
    const builder = new TypeScriptClientBuilder({ projectRoot: root, outDir: join(root, 'dist') });

    await expect(builder.load(source, pageEntry(source))).rejects.toMatchObject({
      name: ClientSourceError.name,
      source,
      line: 3,
    });
  });

  it('loads production artifacts without TypeScript compilation', async () => {
    const root = await temp();
    const source = join(root, 'pages/status.tsx');
    const entry = pageEntry(source);
    const loader = new ManifestClientModuleLoader({
      protocol: 1,
      entries: [{ ...entry, module: '/status.js', hash: 'abc', metadata: { title: 'Status' } }],
    });
    let serverLoads = 0;
    const server: ModuleRuntime = {
      async load<T>(): Promise<T> { serverLoads += 1; return { default: 'server' } as T; },
      async close() {},
    };
    const modules = new ClientBuildModuleRuntime(server, loader);

    await expect(modules.loadClientModule?.('/installed/package/pages/status.tsx', entry)).resolves.toEqual({
      module: '/status.js',
      hash: 'abc',
      metadata: { title: 'Status' },
    });
    expect(serverLoads).toBe(0);
    await modules.load('/plugin.js');
    expect(serverLoads).toBe(1);
  });

  it('requires Page and Layout modules to have a default export', async () => {
    const root = await temp();
    const source = join(root, 'pages/$nav.tsx');
    await writeSource(source, 'export const value = 1;');
    const builder = new TypeScriptClientBuilder({ projectRoot: root, outDir: join(root, 'dist') });
    const request: ClientModuleRequest = {
      feature: 'zhin.layout' as never,
      owner: 'root' as never,
      localName: 'nav',
    };
    await expect(builder.load(source, request)).rejects.toThrow('must have a default export');
  });
});

function pageEntry(source: string) {
  return {
    source,
    feature: 'zhin.page' as never,
    owner: 'root' as never,
    localName: 'status',
  };
}

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-client-build-'));
  temporary.push(root);
  return root;
}

async function writeSource(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
