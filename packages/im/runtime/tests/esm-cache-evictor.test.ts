import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeDevelopmentModuleRuntime } from '../src/index.js';
import type { EsmCacheEvictor } from '../src/esm-cache-evictor.js';

const temporary: string[] = [];
const execFileAsync = promisify(execFile);
const tsxLoaderUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

/** Records evictions against a fixed URL list standing in for Node's load cache. */
function fakeEvictor(urls: string[]): EsmCacheEvictor & { evicted: string[] } {
  const evicted: string[] = [];
  return {
    evicted,
    urls: () => urls.filter((url) => !evicted.includes(url)),
    evict: (url) => {
      evicted.push(url);
      return true;
    },
  };
}

describe('retired module eviction', () => {
  it('evicts only zhin-generation file URLs that no committed entry was loaded at', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.js');
    await writeFile(source, 'export default 1;\n');
    const cache = fakeEvictor([
      'file:///p/a.js?zhin-generation=0',
      'file:///p/a.js?zhin-generation=1',
      'file:///p/h.js?x=1&zhin-generation=0',
      'file:///p/plain.js',
      'node:fs',
    ]);
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false, evictRetiredModules: cache });
    await runtime.load(source);

    runtime.beginGeneration();
    runtime.invalidate(source);
    await writeFile(source, 'export default 2;\n');
    expect((await runtime.load<{ default: number }>(source)).default).toBe(2);
    runtime.commitGeneration([source]);

    expect(cache.evicted).toEqual([
      'file:///p/a.js?zhin-generation=0',
      'file:///p/h.js?x=1&zhin-generation=0',
    ]);
    expect(runtime.evictionStats).toEqual({ enabled: true, evicted: 2 });
    await runtime.close();
  });

  it('keeps the revision a rolled-back entry is still running on', async () => {
    const root = await fixture();
    const first = join(root, 'commands/first/index.js');
    const second = join(root, 'commands/second/index.js');
    await mkdir(join(root, 'commands/first'), { recursive: true });
    await mkdir(join(root, 'commands/second'), { recursive: true });
    await writeFile(first, 'export default 1;\n');
    await writeFile(second, 'export default 1;\n');
    const cache = fakeEvictor([0, 1, 2].map((revision) => `file:///p/x.js?zhin-generation=${revision}`));
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false, evictRetiredModules: cache });
    await runtime.load(first);
    await runtime.load(second);

    // A failed reload of `first` leaves the committed generation on revision 0.
    runtime.beginGeneration();
    runtime.invalidate(first);
    await writeFile(first, 'export default {;\n');
    await expect(runtime.load(first)).rejects.toThrow();
    runtime.rollbackGeneration();
    expect(cache.evicted).toEqual([]);

    runtime.beginGeneration();
    runtime.invalidate(second);
    await writeFile(second, 'export default 2;\n');
    await runtime.load(second);
    runtime.commitGeneration([first, second]);

    expect(cache.evicted).toEqual(['file:///p/x.js?zhin-generation=1']);
    await runtime.close();
  });

  it('does nothing when disabled', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.js');
    await writeFile(source, 'export default 1;\n');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false, evictRetiredModules: false });
    await runtime.load(source);
    runtime.beginGeneration();
    runtime.invalidate(source);
    await runtime.load(source);
    runtime.commitGeneration([source]);
    expect(runtime.evictionStats).toEqual({ enabled: false, evicted: 0 });
    await runtime.close();
  });

  it('lets V8 collect retired generations through the real Node load cache', async () => {
    const root = await fixture();
    const source = join(root, 'commands/status/index.js');
    const helper = join(root, 'commands/status/state.js');
    await writeFile(source, "import { state } from './state.js';\nexport default state;\n");
    const scenario = join(root, 'evict-scenario.mjs');
    await writeFile(scenario, `
import { writeFile } from 'node:fs/promises';
import { NativeDevelopmentModuleRuntime } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
const helper = ${JSON.stringify(helper)}, source = ${JSON.stringify(source)};
const write = (g) => writeFile(helper, 'export const state = { g: ' + g + ', blob: new Array(1e5).fill(' + g + ') };\\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: ${JSON.stringify(root)}, watch: false });
const retired = [];
await write(0);
let current = await runtime.load(source);
for (let g = 1; g <= 5; g++) {
  await tick();
  retired.push(new WeakRef(current.default));
  await write(g);
  runtime.beginGeneration();
  runtime.invalidate(helper);
  current = await runtime.load(source);
  runtime.commitGeneration([source]);
}
await tick(); globalThis.gc(); globalThis.gc();
process.stdout.write(JSON.stringify({ stats: runtime.evictionStats, value: current.default.g,
  alive: retired.filter((ref) => ref.deref()).length }));
await runtime.close();
`);
    const { stdout } = await execFileAsync(process.execPath,
      ['--expose-gc', '--conditions=development', '--import', tsxLoaderUrl, scenario],
      { cwd: process.cwd() });
    const result = JSON.parse(stdout);
    expect(result.value).toBe(5);
    expect(result.stats.enabled).toBe(true);
    // entry + helper for each of the five retired revisions
    expect(result.stats.evicted).toBe(10);
    expect(result.alive).toBe(0);
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-esm-evict-'));
  temporary.push(root);
  await mkdir(join(root, 'commands/status'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  return realpath(root);
}
