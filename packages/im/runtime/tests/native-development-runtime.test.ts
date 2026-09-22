import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { register } from 'tsx/esm/api';
import {
  NativeDevelopmentModuleRuntime,
  supportsNativeTypeScript,
  type ModuleRuntime,
} from '../src/index.js';

const temporary: string[] = [];
const execFileAsync = promisify(execFile);
const tsxLoaderUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const nativeTypeScriptIt = supportsNativeTypeScript() ? it : it.skip;
const inheritedStripTypeArguments = process.execArgv.includes('--experimental-strip-types')
  ? ['--experimental-strip-types']
  : [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('NativeDevelopmentModuleRuntime', () => {
  it('uses URL revisions to reload one directly owned ESM definition', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.js');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    await writeFile(source, 'export default 1;\n');
    expect((await runtime.load<{ default: number }>(source)).default).toBe(1);

    await writeFile(source, 'export default 2;\n');
    runtime.invalidate(source);
    expect((await runtime.load<{ default: number }>(source)).default).toBe(2);
    await runtime.close();
  });

  nativeTypeScriptIt('maps a transitive helper outside an entry directory back to that entry', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.ts');
    const helper = join(root, 'src/status-message.ts');
    const bridge = join(root, 'src/status-command.ts');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(helper, "export const statusMessage = 'v1';\n");
    await writeFile(
      bridge,
      "export { statusMessage } from './status-message.js';\n",
    );
    await writeFile(
      source,
      "import { statusMessage } from '../../src/status-command.js';\nexport default statusMessage;\n",
    );
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    const modules: ModuleRuntime = runtime;

    expect((await runtime.load<{ default: string }>(source)).default).toBe('v1');
    expect(modules.affectedSources?.(helper)).toEqual([helper, source]);
    expect(runtime.requiresProcessRestart(helper)).toBe(false);
    await runtime.close();
  });

  nativeTypeScriptIt('maps package-local import aliases back to their loaded entry', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.ts');
    const helper = join(root, 'src/status-message.ts');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({
      type: 'module',
      imports: { '#status-message': './src/status-message.ts' },
    }));
    await writeFile(helper, "export const statusMessage = 'ready';\n");
    await writeFile(
      source,
      "import { statusMessage } from '#status-message';\nexport default statusMessage;\n",
    );
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    expect((await runtime.load<{ default: string }>(source)).default).toBe('ready');
    expect(runtime.affectedSources(helper)).toEqual([helper, source]);
    expect(runtime.requiresProcessRestart(helper)).toBe(false);
    await runtime.close();
  });

  nativeTypeScriptIt('reloads the complete relative import closure in a real Node process', async () => {
    const root = await fixture();
    const runtimeEntry = new URL('../src/index.ts', import.meta.url).href;
    const scenario = join(root, 'hmr-scenario.mjs');
    await writeFile(scenario, `
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureTypeScriptSpecifierRemap, NativeDevelopmentModuleRuntime } from ${JSON.stringify(runtimeEntry)};
const root = ${JSON.stringify(root)};
const entry = join(root, 'commands/status/index.ts');
const helper = join(root, 'src/status-message.ts');
const bridge = join(root, 'src/status-command.ts');
await mkdir(join(root, 'src'), { recursive: true });
await writeFile(helper, "export const statusMessage = 'v1';\\n");
await writeFile(bridge, "export { statusMessage } from './status-message.js';\\n");
await writeFile(entry, "import { statusMessage } from '../../src/status-command.js';\\nexport default statusMessage;\\n");
ensureTypeScriptSpecifierRemap();
const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
const first = (await runtime.load(entry)).default;
await writeFile(helper, "export const statusMessage = 'v2';\\n");
runtime.invalidate(helper);
const second = (await runtime.load(entry)).default;
await runtime.close();
process.stdout.write(JSON.stringify({ first, second }));
`);

    const { stdout } = await execFileAsync(
      process.execPath,
      [...inheritedStripTypeArguments, '--import', tsxLoaderUrl, scenario],
      { cwd: process.cwd() },
    );
    expect(JSON.parse(stdout)).toEqual({ first: 'v1', second: 'v2' });
  });

  nativeTypeScriptIt('loads native .mts and .cts capability entries consistently', async () => {
    const root = await fixture();
    const mts = join(root, 'commands/status/index.mts');
    const cts = join(root, 'commands/status/index.cts');
    const cjsHelper = join(root, 'commands/status/helper.cjs');
    await writeFile(mts, 'export default 1;\n');
    await writeFile(cts, "module.exports = require('./helper.cjs');\n");
    await writeFile(cjsHelper, 'module.exports = 2;\n');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    expect((await runtime.load<{ default: number }>(mts)).default).toBe(1);
    expect((await runtime.load<{ default: number }>(cts)).default).toBe(2);
    expect(runtime.affectedSources(cjsHelper)).toEqual([cjsHelper, cts]);
    expect(runtime.requiresProcessRestart(mts)).toBe(false);
    expect(runtime.requiresProcessRestart(cts)).toBe(true);
    expect(runtime.requiresProcessRestart(cjsHelper)).toBe(true);
    await runtime.close();
  });

  it('keeps the committed dependency mapping when a replacement module fails to load', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.js');
    const helper = join(root, 'src/status-message.js');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(helper, "export const statusMessage = 'ready';\n");
    await writeFile(
      source,
      "import { statusMessage } from '../../src/status-message.js';\nexport default statusMessage;\n",
    );
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    await runtime.load(source);

    await writeFile(source, 'export default {;\n');
    runtime.invalidate(helper);
    await expect(runtime.load(source)).rejects.toThrow();

    expect(runtime.affectedSources(helper)).toEqual([helper, source]);
    await runtime.close();
  });

  it('stages dependency changes until the generation transaction commits', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.js');
    const firstHelper = join(root, 'src/first-message.js');
    const secondHelper = join(root, 'src/second-message.js');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(firstHelper, "export const statusMessage = 'first';\n");
    await writeFile(secondHelper, "export const statusMessage = 'second';\n");
    await writeFile(
      source,
      "import { statusMessage } from '../../src/first-message.js';\nexport default statusMessage;\n",
    );
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    await runtime.load(source);

    runtime.beginGeneration();
    runtime.invalidate(source);
    await writeFile(
      source,
      "import { statusMessage } from '../../src/second-message.js';\nexport default statusMessage;\n",
    );
    await runtime.load(source);
    runtime.rollbackGeneration();
    expect(runtime.affectedSources(firstHelper)).toEqual([firstHelper, source]);
    expect(runtime.affectedSources(secondHelper)).toEqual([secondHelper]);

    runtime.beginGeneration();
    await runtime.load(source);
    runtime.commitGeneration([source]);
    expect(runtime.affectedSources(firstHelper)).toEqual([firstHelper]);
    expect(runtime.affectedSources(secondHelper)).toEqual([secondHelper, source]);
    await runtime.close();
  });

  it('drops dependency mappings only when committed ownership removes an entry', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.js');
    const helper = join(root, 'src/status-message.js');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(helper, "export const statusMessage = 'ready';\n");
    await writeFile(
      source,
      "import { statusMessage } from '../../src/status-message.js';\nexport default statusMessage;\n",
    );
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    await runtime.load(source);
    expect(runtime.affectedSources(helper)).toEqual([helper, source]);
    runtime.commitGeneration([]);
    expect(runtime.affectedSources(helper)).toEqual([helper]);
    await runtime.close();
  });

  it('loads a published JavaScript entry from node_modules without TypeScript stripping', async () => {
    const root = await fixture();
    const packageRoot = join(root, 'node_modules/@test/plugin');
    const source = join(packageRoot, 'plugin.js');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), '{"type":"module"}\n');
    await writeFile(source, 'export default { installed: true };\n');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    const loaded = await runtime.load<{ default: { installed: boolean } }>(source);

    expect(loaded.default).toEqual({ installed: true });
    await runtime.close();
  });

  it('delegates TSX to the configured process loader and reloads revisions', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.tsx');
    const jsxPackage = join(root, 'node_modules/test-jsx');
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
    const unregister = register({ tsconfig: join(root, 'tsconfig.json') });
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    try {
      await writeFile(source, 'export default <status value={1}>ready</status>;\n');
      expect((await runtime.load<{ default: { props: { value: number } } }>(source)).default.props.value)
        .toBe(1);

      await writeFile(source, 'export default <status value={2}>ready</status>;\n');
      runtime.invalidate(source);
      expect((await runtime.load<{ default: { props: { value: number } } }>(source)).default.props.value)
        .toBe(2);
    } finally {
      await runtime.close();
      await unregister();
    }
  });

  it('keeps direct capabilities local and escalates support modules before they are indexed', async () => {
    const root = await fixture();
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    expect(runtime.requiresProcessRestart(join(root, 'commands/gh/status/index.ts'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'commands/gh/status/index.tsx'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'commands/gh/status/index.mts'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'commands/gh/status/index.cts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'components/card/index.ts'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'components/card/index.tsx'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'tools/weather/index.ts'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'tools/shared/client.ts'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'src/helper.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'src/helper.mts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'src/helper.cts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'schema.json'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, '.env'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, '.env.production'))).toBe(true);
    await runtime.close();
  });

  it('escalates non-entry support files inside capability directories', async () => {
    const root = await fixture();
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    expect(runtime.requiresProcessRestart(join(root, 'commands/_utils.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'commands/_utils/format.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'commands/utils.js'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'commands/format/index.json'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'components/Card.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'commands/notes.md'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'commands/gh/status/index.ts'))).toBe(false);
    await runtime.close();
  });

  it('reports the native Node TypeScript version contract deterministically', () => {
    expect(supportsNativeTypeScript('22.14.0', [], '')).toBe(false);
    expect(supportsNativeTypeScript('22.14.0', ['--experimental-strip-types'], '')).toBe(true);
    expect(supportsNativeTypeScript('22.14.0', [], '--experimental-strip-types')).toBe(true);
    expect(supportsNativeTypeScript('22.18.0', [], '')).toBe(true);
    expect(supportsNativeTypeScript('23.5.0', [], '')).toBe(false);
    expect(supportsNativeTypeScript('23.6.0', [], '')).toBe(true);
    expect(supportsNativeTypeScript('24.0.0', [], '')).toBe(true);
  });

  it('reports source changes without a third-party watcher', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.tsx');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root });
    const observed = new Promise<string>((resolve, reject) => {
      // fs events can be delayed for seconds when the harness runs suites in
      // parallel; keep the budget well above that instead of a tight 2s.
      const timeout = setTimeout(() => reject(new Error('watch timeout')), 15_000);
      const dispose = runtime.watch((changed) => {
        if (changed !== source) return;
        clearTimeout(timeout);
        dispose();
        resolve(changed);
      });
    });

    // fs.watch attaches asynchronously on some platforms; keep rewriting until
    // the watcher observes a change so the attach race cannot lose the event.
    const writer = setInterval(() => {
      void writeFile(source, `export default ${Date.now()};\n`).catch(() => {});
    }, 200);
    try {
      await writeFile(source, 'export default 1;\n');
      await expect(observed).resolves.toBe(source);
    } finally {
      clearInterval(writer);
      await runtime.close();
    }
  });

  it('watches a sibling workspace child Plugin root after the graph commits', async () => {
    const root = await fixture();
    const sibling = await fixture();
    const source = join(sibling, 'commands/status/index.ts');
    await writeFile(join(sibling, 'package.json'), JSON.stringify({
      name: '@test/sibling',
      type: 'module',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
    }));
    await writeFile(join(sibling, 'plugin.ts'), 'export default {};\n');
    await writeFile(source, 'export default 0;\n');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root });
    runtime.updateWatchRoots([{ root: sibling, source: 'workspace' }]);
    expect(runtime.requiresProcessRestart(source)).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'node_modules/@test/plugin/commands/status/index.ts')))
      .toBe(true);

    const observed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch timeout')), 15_000);
      const dispose = runtime.watch((changed) => {
        if (changed !== source) return;
        clearTimeout(timeout);
        dispose();
        resolve(changed);
      });
    });
    const writer = setInterval(() => {
      void writeFile(source, `export default ${Date.now()};\n`).catch(() => {});
    }, 200);
    try {
      await expect(observed).resolves.toBe(source);
    } finally {
      clearInterval(writer);
      await runtime.close();
    }
  });

  it('ignores build output directories like the polling snapshot does', async () => {
    const root = await fixture();
    await mkdir(join(root, 'lib'), { recursive: true });
    const ignored = join(root, 'lib/bundle.js');
    const source = join(root, 'commands/status/index.ts');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root });
    const reported: string[] = [];
    const observed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch timeout')), 15_000);
      const dispose = runtime.watch((changed) => {
        reported.push(changed);
        if (changed !== source) return;
        clearTimeout(timeout);
        dispose();
        resolve();
      });
    });

    // Write both the ignored build output and a real source until the watcher
    // observes the source; any native event for lib/ would arrive first.
    const writer = setInterval(() => {
      void writeFile(ignored, `export default ${Date.now()};\n`).catch(() => {});
      void writeFile(source, `export default ${Date.now()};\n`).catch(() => {});
    }, 200);
    try {
      await writeFile(ignored, 'export default 0;\n');
      await writeFile(source, 'export default 1;\n');
      await observed;
      expect(reported).toContain(source);
      expect(reported).not.toContain(ignored);
    } finally {
      clearInterval(writer);
      await runtime.close();
    }
  });

  it('ignores runtime data/ directory so schedule-jobs.json cannot loop HMR', async () => {
    const root = await fixture();
    await mkdir(join(root, 'data'), { recursive: true });
    const ignored = join(root, 'data/schedule-jobs.json');
    const source = join(root, 'commands/status/index.ts');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root });
    const reported: string[] = [];
    const observed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch timeout')), 15_000);
      const dispose = runtime.watch((changed) => {
        reported.push(changed);
        if (changed !== source) return;
        clearTimeout(timeout);
        dispose();
        resolve();
      });
    });

    const writer = setInterval(() => {
      void writeFile(ignored, `${JSON.stringify({ version: 1, jobs: [], t: Date.now() })}\n`).catch(() => {});
      void writeFile(source, `export default ${Date.now()};\n`).catch(() => {});
    }, 200);
    try {
      await writeFile(ignored, '{"version":1,"jobs":[]}\n');
      await writeFile(source, 'export default 1;\n');
      await observed;
      expect(reported).toContain(source);
      expect(reported).not.toContain(ignored);
    } finally {
      clearInterval(writer);
      await runtime.close();
    }
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-native-runtime-'));
  temporary.push(root);
  await mkdir(join(root, 'commands/status'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  return realpath(root);
}
