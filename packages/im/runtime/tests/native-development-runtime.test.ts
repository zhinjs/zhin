import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NativeDevelopmentModuleRuntime,
  supportsNativeTypeScript,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('NativeDevelopmentModuleRuntime', () => {
  it('uses URL revisions to reload one directly owned ESM definition', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status.js');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    await writeFile(source, 'export default 1;\n');
    expect((await runtime.load<{ default: number }>(source)).default).toBe(1);

    await writeFile(source, 'export default 2;\n');
    runtime.invalidate(source);
    expect((await runtime.load<{ default: number }>(source)).default).toBe(2);
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

  it('keeps direct capabilities local and escalates cached support modules', async () => {
    const root = await fixture();
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    expect(runtime.requiresProcessRestart(join(root, 'commands/gh/status.ts'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'components/card.ts'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'tools/weather.ts'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'tools/shared/client.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'src/helper.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'schema.json'))).toBe(false);
    await runtime.close();
  });

  it('escalates non-entry support files inside capability directories', async () => {
    const root = await fixture();
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    expect(runtime.requiresProcessRestart(join(root, 'commands/_utils.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'commands/_utils/format.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'commands/utils.js'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'commands/format.json'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'components/Card.ts'))).toBe(true);
    expect(runtime.requiresProcessRestart(join(root, 'commands/notes.md'))).toBe(false);
    expect(runtime.requiresProcessRestart(join(root, 'commands/gh/status.ts'))).toBe(false);
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
    const source = join(root, 'commands/status.ts');
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
    const source = join(sibling, 'commands/status.ts');
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
    expect(runtime.requiresProcessRestart(join(root, 'node_modules/@test/plugin/commands/status.ts')))
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
    const source = join(root, 'commands/status.ts');
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
    const source = join(root, 'commands/status.ts');
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
  await mkdir(join(root, 'commands'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  return realpath(root);
}
