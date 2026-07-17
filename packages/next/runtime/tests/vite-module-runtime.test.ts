import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ViteModuleRuntime } from '../src/vite-module-runtime.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Vite TypeScript ModuleRuntime', () => {
  it('loads native TypeScript and invalidates a changed module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-next-vite-'));
    temporary.push(root);
    await mkdir(root, { recursive: true });
    const source = join(root, 'value.ts');
    await writeFile(source, 'export default { value: 1 };\n');
    const runtime = await ViteModuleRuntime.create(root);

    try {
      const first = await runtime.load<{ default: { value: number } }>(source);
      expect(first.default.value).toBe(1);

      await writeFile(source, 'export default { value: 2 };\n');
      runtime.invalidate(source);
      const second = await runtime.load<{ default: { value: number } }>(source);
      expect(second.default.value).toBe(2);
    } finally {
      await runtime.close();
    }
  });
});
