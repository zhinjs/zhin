import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

it('loads a discovered JSX middleware through the default RootHost in a plain Node process', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-root-host-tsx-')));
  const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    await symlink(join(cliRoot, 'node_modules'), join(root, 'node_modules'), 'junction');
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: '@test/root-host-tsx', type: 'module',
      dependencies: { '@zhin.js/middleware': '1.1.1' },
      zhin: {
        protocol: 1, type: 'plugin', entry: './plugin.js',
        features: [{ package: '@zhin.js/middleware', api: '^1.0.0' }],
      },
    }));
    await writeFile(join(root, 'plugin.js'), `
      import { definePlugin } from '@zhin.js/plugin-runtime';
      export default definePlugin({ name: 'root' });
    `);
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { jsx: 'react', jsxFactory: 'h' },
    }));
    await mkdir(join(root, 'middlewares/status'), { recursive: true });
    await writeFile(join(root, 'middlewares/status/index.tsx'), `
      import { defineMiddleware } from '@zhin.js/middleware';
      const h = (_tag, _props, ...children) => children.join('');
      export default defineMiddleware({ handle: () => <div>JSX loaded</div> });
    `);
    // Compile the composition root only. The child runs without a global TSX loader,
    // so the discovered .tsx module must use RootHost's own scoped loader.
    await build({
      entryPoints: [join(cliRoot, 'src/plugin-runtime/root-host.ts')],
      bundle: true, packages: 'external', platform: 'node', format: 'esm',
      outfile: join(root, 'root-host.mjs'),
    });
    await writeFile(join(root, 'scenario.mjs'), `
      import { RootHost } from './root-host.mjs';
      const host = new RootHost({ projectRoot: process.cwd(), config: { configVersion: 2 }, watch: false });
      try {
        const summary = await host.start();
        const slot = [...host.runtime.snapshot.capabilities.values()][0];
        console.log(JSON.stringify({ count: summary.capabilities, result: await slot.definition.handle() }));
      } finally { await host.stop(); }
    `);
    const { stdout } = await promisify(execFile)(process.execPath, [join(root, 'scenario.mjs')], {
      cwd: root, env: { ...process.env, NODE_OPTIONS: '' },
    });
    expect(JSON.parse(stdout)).toEqual({ count: 1, result: 'JSX loaded' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ADR 0040 §5 (slice E2): an approved self-change reloads its written files through the HMR path, also under --no-watch.
it('reloads explicitly written sources without a file watcher', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-root-host-reload-')));
  const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    await symlink(join(cliRoot, 'node_modules'), join(root, 'node_modules'), 'junction');
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: '@test/root-host-reload', type: 'module',
      dependencies: { '@zhin.js/middleware': '1.1.1' },
      zhin: {
        protocol: 1, type: 'plugin', entry: './plugin.js',
        features: [{ package: '@zhin.js/middleware', api: '^1.0.0' }],
      },
    }));
    await writeFile(join(root, 'plugin.js'), `
      import { definePlugin } from '@zhin.js/plugin-runtime';
      export default definePlugin({ name: 'root' });
    `);
    await mkdir(join(root, 'middlewares/status'), { recursive: true });
    const source = join(root, 'middlewares/status/index.js');
    await writeFile(source, `
      import { defineMiddleware } from '@zhin.js/middleware';
      export default defineMiddleware({ handle: () => 'before' });
    `);
    await build({
      entryPoints: [join(cliRoot, 'src/plugin-runtime/root-host.ts')],
      bundle: true, packages: 'external', platform: 'node', format: 'esm',
      outfile: join(root, 'root-host.mjs'),
    });
    await writeFile(join(root, 'scenario.mjs'), `
      import { writeFile } from 'node:fs/promises';
      import { RootHost } from './root-host.mjs';
      const host = new RootHost({ projectRoot: process.cwd(), config: { configVersion: 2 }, watch: false });
      const handle = () => [...host.runtime.snapshot.capabilities.values()][0].definition.handle();
      let notStarted;
      try { await host.reloadSources([]); } catch (error) { notStarted = error.message; }
      try {
        await host.start();
        const before = { generation: host.runtime.snapshot.generation, result: await handle() };
        await writeFile(${JSON.stringify(source)}, "import { defineMiddleware } from '@zhin.js/middleware';\\nexport default defineMiddleware({ handle: () => 'after' });\\n");
        const outcome = await host.reloadSources([${JSON.stringify(source)}]);
        const after = { generation: host.runtime.snapshot.generation, result: await handle() };
        console.log(JSON.stringify({ notStarted, before, outcome, after }));
      } finally { await host.stop(); }
    `);
    const { stdout } = await promisify(execFile)(process.execPath, [join(root, 'scenario.mjs')], {
      cwd: root, env: { ...process.env, NODE_OPTIONS: '' },
    });
    const result = JSON.parse(stdout);
    expect(result.notStarted).toBe('RootHost is not started');
    expect(result.before.result).toBe('before');
    expect(result.outcome).toBe('reloaded');
    expect(result.after.result).toBe('after');
    expect(result.after.generation).toBeGreaterThan(result.before.generation);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
