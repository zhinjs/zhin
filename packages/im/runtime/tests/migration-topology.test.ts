import { readFile, stat } from 'node:fs/promises';
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
  readonly removed: readonly {
    readonly sourcePackage: string;
    readonly sourceDirectory: string;
    readonly reason: string;
  }[];
}

describe('in-place migration topology', () => {
  it('accounts for every temporary package and removes completed sources', async () => {
    const root = process.cwd();
    const topology = JSON.parse(await readFile(join(
      root,
      'docs/architecture/target-implementation/migration-topology.json',
    ), 'utf8')) as MigrationTopology;
    expect(topology.pending).toEqual([]);
    await expect(stat(join(root, 'packages/next'))).rejects.toThrow();
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
    for (const removed of topology.removed) {
      expect(removed.reason).not.toHaveLength(0);
      await expect(readFile(join(root, removed.sourceDirectory, 'package.json'), 'utf8'))
        .rejects.toThrow();
    }
  });
});
