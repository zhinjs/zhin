import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface MigrationTopology {
  readonly completed: readonly {
    readonly sourcePackage: string;
    readonly sourceDirectory: string;
    readonly targetPackage: string;
    readonly targetDirectory: string;
    readonly targetExport: string;
  }[];
  readonly pending: readonly {
    readonly sourcePackage: string;
    readonly target: string;
  }[];
}

describe('in-place migration topology', () => {
  it('accounts for every temporary package and removes completed sources', async () => {
    const root = process.cwd();
    const topology = JSON.parse(await readFile(join(
      root,
      'docs/architecture/target-implementation/migration-topology.json',
    ), 'utf8')) as MigrationTopology;
    const directories = await readdir(join(root, 'packages/next'), { withFileTypes: true });
    const actual: string[] = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await readFile(
          join(root, 'packages/next', directory.name, 'package.json'),
          'utf8',
        )) as { name?: string };
        if (manifest.name?.startsWith('@zhin.js/next-')) actual.push(manifest.name);
      } catch { /* A removed package may retain ignored local build artifacts. */ }
    }

    expect(actual.sort()).toEqual(topology.pending.map((item) => item.sourcePackage).sort());
    for (const completed of topology.completed) {
      await expect(readFile(join(root, completed.sourceDirectory, 'package.json'), 'utf8'))
        .rejects.toThrow();
      const target = JSON.parse(await readFile(
        join(root, completed.targetDirectory, 'package.json'),
        'utf8',
      )) as { name?: string; exports?: Record<string, unknown> };
      expect(target.name).toBe(completed.targetPackage);
      expect(target.exports).toHaveProperty(completed.targetExport);
    }
  });
});
