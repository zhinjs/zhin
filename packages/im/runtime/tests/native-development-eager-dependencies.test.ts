import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// #1250 `prod-runs-dependency-index`: with file watching every entry is analyzed as it loads.
// A file of its own, so es-module-lexer is provably not loaded before the first load.
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

describe('NativeDevelopmentModuleRuntime eager dependency tracking', () => {
  it('keeps analyzing every entry as it loads when watching', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-eager-deps-'));
    temporary.push(directory);
    const root = await realpath(directory);
    await mkdir(join(root, 'commands/status'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    const helper = join(root, 'src/message.js');
    const entry = join(root, 'commands/status/index.js');
    await writeFile(helper, "export const message = 'v1';\n");
    await writeFile(entry, "import { message } from '../../src/message.js';\nexport default message;\n");
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: true });

    expect(probe.lexerImports).toBe(0);
    expect((await runtime.load<{ default: string }>(entry)).default).toBe('v1');
    expect(probe.analyzed).toEqual([entry]);
    expect(probe.lexerImports).toBe(1);
    expect(runtime.affectedSources(helper)).toEqual([helper, entry]);
    expect(runtime.requiresProcessRestart(helper)).toBe(false);
    await runtime.prepareInvalidation();
    expect(probe.analyzed).toEqual([entry]);
    await runtime.close();
  });
});
