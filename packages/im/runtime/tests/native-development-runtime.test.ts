import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      const timeout = setTimeout(() => reject(new Error('watch timeout')), 2_000);
      const dispose = runtime.watch((changed) => {
        if (changed !== source) return;
        clearTimeout(timeout);
        dispose();
        resolve(changed);
      });
    });

    await writeFile(source, 'export default 1;\n');
    await expect(observed).resolves.toBe(source);
    await runtime.close();
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-native-runtime-'));
  temporary.push(root);
  await mkdir(join(root, 'commands'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  return root;
}
