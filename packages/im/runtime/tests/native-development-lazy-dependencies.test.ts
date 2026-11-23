import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// #1250 `prod-runs-dependency-index`: without file watching the module runtime must not analyze
// imports or load es-module-lexer (its WebAssembly memory never shrinks) until a reload needs it.
const probe = vi.hoisted(() => ({ lexerImports: 0, analyzed: [] as string[] }));

vi.mock('es-module-lexer', async (importOriginal) => {
  probe.lexerImports += 1;
  return importOriginal();
});

vi.mock('../src/module-dependency-index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/module-dependency-index.js')>();
  class RecordingModuleDependencyIndex extends actual.ModuleDependencyIndex {
    override async analyze(entry: string) {
      probe.analyzed.push(entry);
      return super.analyze(entry);
    }
  }
  return { ...actual, ModuleDependencyIndex: RecordingModuleDependencyIndex };
});

const { NativeDevelopmentModuleRuntime } = await import('../src/native-development-runtime.js');

const temporary: string[] = [];

afterEach(async () => {
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

  it('keeps analyzing every entry as it loads when watching', async () => {
    const { root, entry, helper } = await fixture('eager');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: true });

    expect((await runtime.load<{ default: string }>(entry)).default).toBe('v1');
    expect(probe.analyzed).toContain(entry);
    expect(probe.lexerImports).toBe(1);
    expect(runtime.affectedSources(helper)).toEqual([helper, entry]);
    expect(runtime.requiresProcessRestart(helper)).toBe(false);
    const analyzed = probe.analyzed.length;
    await runtime.prepareInvalidation();
    expect(probe.analyzed).toHaveLength(analyzed);
    await runtime.close();
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
