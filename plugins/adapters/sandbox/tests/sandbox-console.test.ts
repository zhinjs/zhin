import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClientBuildModuleRuntime,
  TypeScriptClientBuilder,
  extractPageMetadata,
} from '@zhin.js/pagemanager/client-build';
import { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { definePlugin, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import pageFeature, { PageIndex, pageFeatureId } from '@zhin.js/page';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { createHttpHost } from '@zhin.js/host-http';

const temporary: string[] = [];
const hosts: Array<ReturnType<typeof createHttpHost>> = [];
const sandboxPageSource = join(
  dirname(fileURLToPath(import.meta.url)),
  '../pages/sandbox.tsx',
);

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('sandbox console page', () => {
  it('exposes static definePage metadata for convention discovery', async () => {
    const source = await readFile(sandboxPageSource, 'utf8');
    expect(extractPageMetadata(source, sandboxPageSource)).toMatchObject({
      title: '沙盒',
      order: 10,
    });
  });

  it('compiles the sandbox page into a client module artifact', async () => {
    const project = await mkdtemp(join(tmpdir(), 'zhin-sandbox-page-build-'));
    temporary.push(project);
    const sandboxPackageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const builder = new TypeScriptClientBuilder({
      projectRoot: sandboxPackageRoot,
      outDir: join(project, 'dist/client'),
      publicBase: '/assets/client',
    });
    const artifact = await builder.load(sandboxPageSource, {
      feature: pageFeatureId,
      owner: 'root/sandbox',
      localName: 'sandbox',
    });
    expect(artifact).toMatchObject({
      module: expect.stringMatching(/^\/assets\/client\//u),
      metadata: expect.objectContaining({ title: '沙盒' }),
    });
  });

  it('projects the sandbox page into Console catalog and serves its shell', async () => {
    const project = await createProject();
    const pluginSource = join(project, 'plugin.ts');
    const pageProvider = join(project, 'packages/page/index.ts');
    const server = new FakeModules();
    server.set(pluginSource, {
      default: definePlugin({ name: 'root' }),
    });
    server.set(pageProvider, { default: pageFeature });
    // Compile against the real adapter package root so @zhin.js/client / lucide-react resolve.
    const sandboxPackageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const modules = new ClientBuildModuleRuntime(server, new TypeScriptClientBuilder({
      projectRoot: sandboxPackageRoot,
      outDir: join(project, 'dist/client'),
      publicBase: '/assets/client',
    }));
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const consoleRuntime = new ConsoleRuntime();
    consoleRuntime.attach(runtime.controller.snapshots);
    await runtime.start();

    const pages = await consoleRuntime.runView(
      { permissions: [], roles: [] },
      (catalog) => catalog.pages(),
    );
    expect(pages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        localName: 'sandbox',
        title: '沙盒',
        route: '/p-sandbox',
      }),
    ]));
    expect(pageIndex(runtime.snapshot).route('/p-sandbox')?.module)
      .toMatch(/^\/assets\/client\//u);

    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    http.route('GET', '/p-sandbox', async (_request, response) => {
      const match = await consoleRuntime.runView(
        { permissions: [], roles: [] },
        (catalog) => catalog.match('/p-sandbox'),
      );
      expect(match.status).toBe('found');
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html>sandbox-shell</html>');
    });
    const { port } = await http.listen();
    const shell = await fetch(`http://127.0.0.1:${port}/p-sandbox`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('sandbox-shell');

    await runtime.stop();
  });
});

function pageIndex(snapshot: RuntimeSnapshot): PageIndex {
  const value = snapshot.projections.get(pageFeatureId);
  if (!value || !(value instanceof PageIndex)) throw new Error('missing PageIndex');
  return value;
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-sandbox-console-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/page': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      engine: '^1.0.0',
      runtime: 'trusted',
      features: [{ package: '@test/page', api: '^1.0.0' }],
      plugins: [],
    },
  });
  await writeJson(join(root, 'packages/page/package.json'), {
    name: '@test/page',
    type: 'module',
    zhin: {
      protocol: 1,
      type: 'feature',
      entry: './index.ts',
      engine: '^1.0.0',
      featureApi: '1.0.0',
    },
  });
  await touch(join(root, 'plugin.ts'));
  await touch(join(root, 'packages/page/index.ts'));
  // Copy full pages/ so relative imports (SandboxChat, RichTextEditor, transport) resolve.
  const pagesDir = join(dirname(fileURLToPath(import.meta.url)), '../pages');
  const pageFiles = ['sandbox.tsx', 'SandboxChat.tsx', 'RichTextEditor.tsx', 'sandboxTransport.ts'];
  for (const name of pageFiles) {
    const dest = join(root, 'pages', name);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(join(pagesDir, name), 'utf8'));
  }
  return realpath(root);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}

class FakeModules implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`missing module: ${source}`);
    return this.#modules.get(source) as T;
  }

  async close(): Promise<void> {}
}
