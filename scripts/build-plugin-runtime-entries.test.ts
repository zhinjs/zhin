import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPluginRuntimeEntries,
  cleanPluginRuntimeEntries,
} from './build-plugin-runtime-entries.mjs';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('build-plugin-runtime-entries', () => {
  it('emits standalone JS for plugin and nested convention modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-build-'));
    temporary.push(root);
    await mkdir(join(root, 'commands/gh'), { recursive: true });
    await mkdir(join(root, 'tools'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: '@test/plugin',
      type: 'module',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.js' },
    }));
    await writeFile(
      join(root, 'plugin.ts'),
      "import value from './src/value.js';\nexport default value satisfies number;\n",
    );
    await writeFile(
      join(root, 'commands/gh/status.ts'),
      "import value from '../../src/value.js';\nexport default value as number;\n",
    );
    await writeFile(
      join(root, 'tools/status.ts'),
      "import value from '../src/value.js';\nexport default value as number;\n",
    );

    const outputs = await buildPluginRuntimeEntries(root);

    expect(outputs.map((path) => path.slice(root.length + 1))).toEqual([
      'plugin.js',
      'commands/gh/status.js',
      'tools/status.js',
    ]);
    expect(await readFile(join(root, 'plugin.js'), 'utf8'))
      .toContain('./lib/value.js');
    expect(await readFile(join(root, 'commands/gh/status.js'), 'utf8'))
      .toContain('../../lib/value.js');
    expect(await readFile(join(root, 'tools/status.js'), 'utf8'))
      .toContain('../lib/value.js');
  });

  it('cleans only files carrying the generated marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-clean-'));
    temporary.push(root);
    await mkdir(join(root, 'tools'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: '@test/plugin',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.js' },
    }));
    await writeFile(join(root, 'plugin.ts'), 'export default {};\n');
    await writeFile(join(root, 'tools/custom.js'), 'export default 1;\n');
    await buildPluginRuntimeEntries(root);

    await cleanPluginRuntimeEntries(root);

    await expect(readFile(join(root, 'plugin.js'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, 'tools/custom.js'), 'utf8'))
      .resolves.toContain('export default 1');
  });
});
