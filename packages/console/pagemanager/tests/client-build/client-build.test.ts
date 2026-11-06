import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';
import type { ModuleRuntime } from '@zhin.js/runtime';
import {
  ClientBuildModuleRuntime,
  ClientSourceError,
  ManifestClientModuleLoader,
  TypeScriptClientBuilder,
} from '../../src/client-build/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Client build adapter', () => {
  it('extracts literal Page metadata and writes deterministic ESM plus manifest', async () => {
    const root = await temp();
    const source = join(root, 'pages/status.tsx');
    await writeSource(source, [
      "import { definePage } from '@zhin.js/console-contract';",
      "export const meta = definePage({ title: 'Status', titleI18n: { en: 'Status page', 'zh-CN': '状态页' }, order: 10, requiredRoles: ['admin'] });",
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
      metadata: { title: 'Status', titleI18n: { en: 'Status page', 'zh-CN': '状态页' }, order: 10, requiredRoles: ['admin'] },
    });
    const chunk = await readFile(join(root, 'dist/client', artifact!.module.split('/').at(-1)!), 'utf8');
    // Bare `react/jsx-runtime` is rewritten to Host `/esm/…` so browsers can resolve it.
    expect(chunk).toContain('/esm/');
    expect(chunk).toMatch(/from\s+"\/esm\/react(?:%7E|~)jsx-runtime\.mjs/);
    expect(chunk).not.toMatch(/from\s+["']react\/jsx-runtime["']/);
    // `@zhin.js/console-contract` is stubbed/inlined — never left as a bare import.
    expect(chunk).not.toMatch(/from\s+["']@zhin\.js\/console-contract["']/);
    // Remote Console loadConsoleEntries requires `register(api)`.
    expect(chunk).toMatch(/export\s+(?:async\s+)?function\s+register\b|export\s*\{\s*[^}]*\bregister\b/);
    expect(chunk).toContain('addRoute');
    const jsxStub = 'data:text/javascript,export const jsx=()=>null;';
    const runnable = chunk.replace(/(["'])\/esm\/react(?:%7E|~)jsx-runtime\.mjs(?:\?[^"']*)?\1/gu, JSON.stringify(jsxStub));
    const browserModule = await import(`data:text/javascript;base64,${Buffer.from(runnable).toString('base64')}`);
    const routes: unknown[] = [];
    const createdProps: unknown[] = [];
    browserModule.register({
      React: { createElement: (_comp: unknown, props: unknown) => { createdProps.push(props); return null; } },
      addRoute: (route: unknown) => routes.push(route),
    });
    expect(routes).toEqual([
      expect.objectContaining({
        name: 'Status',
        requiredRoles: ['admin'],
        meta: expect.objectContaining({
          order: 10,
          titleI18n: { en: 'Status page', 'zh-CN': '状态页' },
        }),
      }),
    ]);
    expect(createdProps[0]).toMatchObject({
      pluginId: 'root',
      owner: 'root',
      localName: 'status',
      route: '/p-status',
      title: 'Status',
    });

    const persisted = JSON.parse(
      await readFile(join(root, 'dist/client/pages.manifest.json'), 'utf8'),
    ) as { protocol: number; entries: unknown[] };
    expect(persisted).toMatchObject({ protocol: 1, entries: [expect.objectContaining({ hash: artifact?.hash })] });
  });

  it('accepts definePage imported from @zhin.js/page or zhin.js/page and forwards all metadata fields', async () => {
    const root = await temp();
    const source = join(root, 'pages/ops.tsx');
    await writeSource(source, [
      "import { definePage } from '@zhin.js/page';",
      "export const meta = definePage({ title: 'Ops', group: 'system', order: 5, parent: 'root', fullWidth: true, requiredPermissions: ['ops:read'] });",
      'export default function OpsPage() { return <section>Ops</section>; }',
    ].join('\n'));
    const builder = new TypeScriptClientBuilder({
      projectRoot: root,
      outDir: join(root, 'dist/client'),
    });
    const artifact = await builder.load<{ module: string; metadata: unknown }>(source, {
      ...pageEntry(source),
      owner: 'root/ops-plugin' as never,
      localName: 'ops',
    });
    expect(artifact.metadata).toMatchObject({
      title: 'Ops',
      group: 'system',
      order: 5,
      parent: 'root',
      fullWidth: true,
      requiredPermissions: ['ops:read'],
    });
  });

  it('compiles createDeclarativePage and createAdapterConsolePage from @zhin.js/console-contract without @zhin.js/client in node_modules', async () => {
    const root = await temp();
    const declSource = join(root, 'pages/declarative.ts');
    await writeSource(declSource, [
      "import { definePage, createDeclarativePage } from '@zhin.js/console-contract';",
      "export const meta = definePage({ title: 'Declarative Service', group: 'services' });",
      'export default createDeclarativePage({',
      "  title: { zh: '服务', en: 'Declarative Service' },",
      "  stats: [{ label: { zh: '计数', en: 'Count' }, value: 'count' }],",
      '  sections: [{',
      "    title: { zh: '任务', en: 'Tasks' },",
      "    items: 'tasks',",
      "    columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }],",
      '  }],',
      "  actions: [{ name: 'runNow', label: { zh: '执行', en: 'Run Now' } }],",
      '});',
    ].join('\n'));

    const adapterSource = join(root, 'pages/adapter.ts');
    await writeSource(adapterSource, [
      "import { definePage, createAdapterConsolePage } from '@zhin.js/console-contract';",
      "export const meta = definePage({ title: 'Demo Adapter', group: 'adapters' });",
      "export default createAdapterConsolePage('demo');",
    ].join('\n'));

    const builder = new TypeScriptClientBuilder({
      projectRoot: root,
      outDir: join(root, 'dist/client'),
      publicBase: '/assets/zhin',
    });

    const declArtifact = await builder.load<{ module: string; metadata: unknown; blueprint?: unknown }>(declSource, {
      ...pageEntry(declSource),
      owner: 'root/decl-plugin' as never,
      localName: 'declarative',
    });
    expect(declArtifact.blueprint).toMatchObject({
      kind: 'zhin.console.page-blueprint',
      version: 1,
      title: 'Declarative Service',
      dataSource: { action: 'status' },
    });
    const declChunk = await readFile(join(root, 'dist/client', declArtifact.module.split('/').at(-1)!), 'utf8');
    expect(declChunk).toContain('zero-esbuild synthesized module');
    expect(declChunk).not.toMatch(/from\s+["']@zhin\.js\/(?:console-contract|client|page)["']/);
    expect(declChunk).toContain('createDeclarativePage');

    const declMod = await import(`data:text/javascript;base64,${Buffer.from(declChunk).toString('base64')}`);
    expect({ ...declMod.default }).toMatchObject({
      kind: 'zhin.console.page-blueprint',
      version: 1,
      title: 'Declarative Service',
      dataSource: { action: 'status' },
    });
    expect(declMod.default()).toMatchObject({
      kind: 'zhin.console.page-blueprint',
      version: 1,
      title: 'Declarative Service',
      dataSource: { action: 'status' },
    });

    const adapterArtifact = await builder.load<{ module: string; metadata: unknown; blueprint?: unknown }>(adapterSource, {
      ...pageEntry(adapterSource),
      owner: 'root/adapter-demo' as never,
      localName: 'adapter',
    });
    expect(adapterArtifact.blueprint).toEqual({
      kind: 'zhin.console.adapter-page',
      version: 1,
      adapterKey: 'demo',
      dataSource: { action: 'status' },
    });
    const adapterChunk = await readFile(join(root, 'dist/client', adapterArtifact.module.split('/').at(-1)!), 'utf8');
    expect(adapterChunk).toContain('zero-esbuild synthesized module');
    expect(adapterChunk).not.toMatch(/from\s+["']@zhin\.js\/(?:console-contract|client|page)["']/);
    expect(adapterChunk).toContain('createAdapterConsolePage');

    const adapterMod = await import(`data:text/javascript;base64,${Buffer.from(adapterChunk).toString('base64')}`);
    expect({ ...adapterMod.default }).toMatchObject({
      kind: 'zhin.console.adapter-page',
      version: 1,
      adapterKey: 'demo',
      dataSource: { action: 'status' },
    });
    expect(adapterMod.default()).toMatchObject({
      kind: 'zhin.console.adapter-page',
      version: 1,
      adapterKey: 'demo',
      dataSource: { action: 'status' },
    });

    // Prebuilt static client asset (`<name>.bundle.js`) mounts without invoking esbuild
    const heavySource = join(root, 'pages/sandbox/index.tsx');
    await writeSource(heavySource, [
      "import { definePage } from '@zhin.js/console-contract';",
      "export const meta = definePage({ title: 'Sandbox' });",
      'export default function Sandbox() { return <main>Sandbox</main>; }',
    ].join('\n'));
    await writeSource(
      join(root, 'pages/sandbox/index.bundle.js'),
      '// prebuilt static client bundle\nexport function register(api) { api.addRoute({ path: "/sandbox" }); }\n',
    );
    const heavyArtifact = await builder.load<{ module: string; metadata: unknown }>(heavySource, {
      ...pageEntry(heavySource),
      owner: 'root/sandbox' as never,
      localName: 'index',
    });
    const heavyChunk = await readFile(join(root, 'dist/client', heavyArtifact.module.split('/').at(-1)!), 'utf8');
    expect(heavyChunk).toContain('// prebuilt static client bundle');
  });

  it('rejects dynamic metadata with a source location', async () => {
    const root = await temp();
    const source = join(root, 'pages/status.tsx');
    await writeSource(source, [
      "import { definePage } from '@zhin.js/console-contract';",
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

  it('preserves server dependency and generation invalidation ports', async () => {
    const generations: unknown[] = [];
    const roots: unknown[] = [];
    let began = 0;
    let rolledBack = 0;
    const server: ModuleRuntime = {
      async load<T>(): Promise<T> { return {} as T; },
      affectedSources: (source) => [source, '/project/commands/status/index.ts'],
      requiresProcessRestart: () => true,
      beginGeneration: () => { began += 1; },
      commitGeneration: (next) => { generations.push(next); },
      rollbackGeneration: () => { rolledBack += 1; },
      updateWatchRoots: (next) => { roots.push(next); },
      async close() {},
    };
    const modules = new ClientBuildModuleRuntime(server, {
      async load<T>(): Promise<T> { return {} as T; },
    });
    const sources = ['/project/commands/status/index.ts'];
    const watchRoots = [{ root: '/project', source: 'workspace' as const }];

    expect(modules.affectedSources('/project/src/helper.ts')).toEqual([
      '/project/src/helper.ts',
      '/project/commands/status/index.ts',
    ]);
    expect(modules.requiresProcessRestart('/project/src/helper.ts')).toBe(true);
    modules.beginGeneration();
    modules.commitGeneration(sources);
    modules.rollbackGeneration();
    modules.updateWatchRoots(watchRoots);
    expect(began).toBe(1);
    expect(generations).toEqual([sources]);
    expect(rolledBack).toBe(1);
    expect(roots).toEqual([watchRoots]);
  });

  it('requires Page and Layout modules to have a default export', async () => {
    const root = await temp();
    const source = join(root, 'pages/nav/index.tsx');
    await writeSource(source, 'export const value = 1;');
    const builder = new TypeScriptClientBuilder({ projectRoot: root, outDir: join(root, 'dist') });
    const request: ClientModuleRequest = {
      feature: 'zhin.layout' as never,
      owner: 'root' as never,
      localName: 'nav',
    };
    await expect(builder.load(source, request)).rejects.toThrow('must have a default export');
  });

  it('sanitizes adversarial localName/publicBase within a bounded CPU budget (no ReDoS)', async () => {
    const root = await temp();
    const source = join(root, 'pages/status.tsx');
    await writeSource(source, [
      "import { definePage } from '@zhin.js/console-contract';",
      "export const meta = definePage({ title: 'Status' });",
      'export default function Status() { return null; }',
    ].join('\n'));
    const warmBuilder = new TypeScriptClientBuilder({
      projectRoot: root,
      outDir: join(root, 'dist/client'),
    });
    // Warm transpilation before measuring the adversarial sanitization path.
    await warmBuilder.load(source, pageEntry(source));

    const entry = { ...pageEntry(source), localName: '-'.repeat(100_000) };
    const publicBase = `/${'/'.repeat(100_000)}assets`;
    // CPU time excludes filesystem waits and scheduler contention. Start before
    // construction so publicBase sanitization is covered as well as localName.
    const start = process.cpuUsage();
    const builder = new TypeScriptClientBuilder({
      projectRoot: root,
      outDir: join(root, 'dist/client'),
      publicBase,
    });
    const artifact = await builder.load<{ module: string }>(source, entry);
    const cpu = process.cpuUsage(start);
    expect((cpu.user + cpu.system) / 1_000).toBeLessThan(100);
    expect(artifact.module).toMatch(/^\/assets\/root-root-[a-f0-9]{16}\.js$/u);
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
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-client-build-'));
  temporary.push(root);
  return root;
}

async function writeSource(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
