import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldUseSmartBuildInCwd } from '../src/libs/plugin-package-build.js';

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => fs.remove(directory)));
});

async function createPackage(manifest: Record<string, unknown>): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-smart-build-'));
  fixtures.push(directory);
  await fs.outputJson(path.join(directory, 'package.json'), manifest);
  await fs.ensureDir(path.join(directory, 'src'));
  return directory;
}

describe('shouldUseSmartBuildInCwd', () => {
  it('recognizes an explicit package.json zhin manifest', async () => {
    const directory = await createPackage({
      name: 'custom-package',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
    });

    expect(shouldUseSmartBuildInCwd(directory)).toBe(true);
  });

  it('recognizes an application with an explicit zhin.js dependency', async () => {
    const directory = await createPackage({
      name: 'custom-app',
      dependencies: { 'zhin.js': '^1.1.0' },
    });

    expect(shouldUseSmartBuildInCwd(directory)).toBe(true);
  });

  it('does not infer plugin identity from plugin.yml or a package-name prefix', async () => {
    const directory = await createPackage({ name: '@zhin.js/looks-like-a-plugin' });
    await fs.outputFile(path.join(directory, 'plugin.yml'), 'name: legacy\n');

    expect(shouldUseSmartBuildInCwd(directory)).toBe(false);
  });
});
