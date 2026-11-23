import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// #1250 `prod-runs-dependency-index`: without file watching the module runtime must not analyze
// imports or load es-module-lexer (its WebAssembly memory never shrinks) until a reload needs it.
const probe = vi.hoisted(() => ({
  lexerImports: 0,
  analyzed: [] as string[],
  /** Index constructions to fail, standing in for a failed load of the index module. */
  failConstructions: 0,
  /** Entries whose analysis throws. */
  failAnalyze: new Set<string>(),
}));

vi.mock('es-module-lexer', async (importOriginal) => {
  probe.lexerImports += 1;
  return importOriginal();
});

vi.mock('../src/module-dependency-index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/module-dependency-index.js')>();
  class RecordingModuleDependencyIndex extends actual.ModuleDependencyIndex {
    constructor(...args: ConstructorParameters<typeof actual.ModuleDependencyIndex>) {
      if (probe.failConstructions > 0) {
        probe.failConstructions -= 1;
        throw new Error('index unavailable');
      }
      super(...args);
    }

    override async analyze(entry: string) {
      probe.analyzed.push(entry);
      if (probe.failAnalyze.has(entry)) throw new Error(`cannot analyze ${entry}`);
      return super.analyze(entry);
    }
  }
  return { ...actual, ModuleDependencyIndex: RecordingModuleDependencyIndex };
});

const { NativeDevelopmentModuleRuntime } = await import('../src/native-development-runtime.js');

const temporary: string[] = [];

afterEach(async () => {
  probe.analyzed.length = 0;
  probe.failConstructions = 0;
  probe.failAnalyze.clear();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('NativeDevelopmentModuleRuntime dependency tracking', () => {
  it('skips import analysis and es-module-lexer without watch until a reload prepares the graph', async () => {
    const { root, entry, helper } = await fixture('lazy');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });

    expect((await runtime.load<{ default: string }>(entry)).default).toBe('v1');
    expect(probe.analyzed).toEqual([]);
    expect(probe.lexerImports).toBe(0);
    // Without a graph the helper maps to nothing, so a reload of it escalates to a restart.
    expect(runtime.affectedSources(helper)).toEqual([helper]);
    expect(runtime.requiresProcessRestart(helper)).toBe(true);

    runtime.commitGeneration([entry]);
    await runtime.prepareInvalidation();
    expect(probe.lexerImports).toBe(1);
    expect(probe.analyzed).toEqual([entry]);
    expect(runtime.affectedSources(helper)).toEqual([helper, entry]);
    expect(runtime.requiresProcessRestart(helper)).toBe(false);

    // The reloaded closure itself is covered in a real Node process (native-development-runtime.test.ts);
    // the Vitest module runner does not carry the generation query into helper imports.
    await writeFile(helper, "export const message = 'v2';\n");
    runtime.beginGeneration();
    await runtime.invalidate(helper);
    await runtime.load(entry);
    runtime.commitGeneration([entry]);
    // Once built, the graph stays current: the reloaded entry was analyzed again.
    expect(probe.analyzed).toEqual([entry, entry]);
    await runtime.close();
  });

  // Runs after the test above: the index module is already loaded, so only construction can fail.
  it('does not cache a failed index load: the next reload builds the graph (#1250)', async () => {
    const { root, entry, helper } = await fixture('index-failure');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    await runtime.load(entry);
    runtime.commitGeneration([entry]);

    probe.failConstructions = 1;
    await expect(runtime.prepareInvalidation()).rejects.toThrow('index unavailable');
    expect(runtime.requiresProcessRestart(helper)).toBe(true);

    await runtime.prepareInvalidation();
    expect(runtime.affectedSources(helper)).toEqual([helper, entry]);
    expect(runtime.requiresProcessRestart(helper)).toBe(false);
    await runtime.close();
  });

  it('adds an entry committed after an earlier pass took its snapshot on the next reload (#1250)', async () => {
    const { root, entry, helper } = await fixture('late-entry');
    const slow = join(root, 'commands/slow/index.js');
    await mkdir(join(root, 'commands/slow'), { recursive: true });
    // The top-level await keeps the load in flight until after the first pass finished.
    await writeFile(slow, [
      "import { message } from '../../src/message.js';",
      'await new Promise((resolve) => setTimeout(resolve, 300));',
      'export default message;',
    ].join('\n'));
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    await runtime.load(entry);
    runtime.commitGeneration([entry]);

    // Outside an HMR transaction: the load starts before the index exists, so it is not analyzed.
    const loading = runtime.load(slow);
    await runtime.prepareInvalidation();
    expect(runtime.affectedSources(helper)).toEqual([helper, entry]);
    await loading;
    expect(probe.analyzed).not.toContain(slow);

    await runtime.prepareInvalidation();
    expect(probe.analyzed).toContain(slow);
    expect([...runtime.affectedSources(helper)].sort()).toEqual([helper, entry, slow].sort());
    await runtime.close();
  });

  it('falls back to a restart while a loaded entry could not be analyzed, and retries it (#1250)', async () => {
    const { root, entry, helper } = await fixture('analysis-failure');
    const other = join(root, 'commands/other/index.js');
    await mkdir(join(root, 'commands/other'), { recursive: true });
    await writeFile(other, 'export default 1;\n');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    await runtime.load(entry);
    await runtime.load(other);
    runtime.commitGeneration([entry, other]);

    probe.failAnalyze.add(other);
    await runtime.prepareInvalidation();
    // The helper maps to `entry`, but `other` may import it too: only a restart is safe.
    expect(runtime.affectedSources(helper)).toEqual([helper, entry]);
    expect(runtime.requiresProcessRestart(helper)).toBe(true);
    // The unanalyzed entry itself still reloads in place; its new load is analyzed.
    expect(runtime.requiresProcessRestart(other)).toBe(false);

    probe.failAnalyze.clear();
    await runtime.prepareInvalidation();
    expect(runtime.requiresProcessRestart(helper)).toBe(false);

    await runtime.close();

    // A retired unanalyzed entry no longer blocks the reload.
    const retiring = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false });
    await retiring.load(entry);
    await retiring.load(other);
    retiring.commitGeneration([entry, other]);
    probe.failAnalyze.add(other);
    await retiring.prepareInvalidation();
    expect(retiring.requiresProcessRestart(helper)).toBe(true);
    retiring.commitGeneration([entry]);
    expect(retiring.requiresProcessRestart(helper)).toBe(false);
    await retiring.close();
  });
});

async function fixture(name: string): Promise<{ root: string; entry: string; helper: string }> {
  const directory = await mkdtemp(join(tmpdir(), `zhin-lazy-deps-${name}-`));
  temporary.push(directory);
  const root = await realpath(directory);
  await mkdir(join(root, 'commands/status'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  const helper = join(root, 'src/message.js');
  const entry = join(root, 'commands/status/index.js');
  await writeFile(helper, "export const message = 'v1';\n");
  await writeFile(entry, "import { message } from '../../src/message.js';\nexport default message;\n");
  return { root, entry, helper };
}
