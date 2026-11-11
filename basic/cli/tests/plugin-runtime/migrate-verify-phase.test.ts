import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const verify = vi.hoisted(() => vi.fn());
vi.mock('../../src/plugin-runtime/migrate/index.js', () => ({
  MigrationVerifier: class { verify = verify; },
}));

afterEach(() => { vi.restoreAllMocks(); verify.mockReset(); });

describe('zhin runtime migrate verify', () => {
  it('runs the MigrationVerifier without --check/--write and prints its report', async () => {
    verify.mockResolvedValue({
      root: '/project', mode: 'development',
      commands: [{ command: 'pnpm', arguments: ['run', 'build'] }], tarballEntries: [],
    });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { runtimeCommand } = await import('../../src/commands/runtime.js');

    await runtimeCommand.parseAsync(['migrate', 'verify'], { from: 'user' });

    expect(verify).toHaveBeenCalledWith(process.cwd());
    expect(JSON.parse(String(write.mock.calls.at(-1)![0]))).toEqual({
      mode: 'development',
      commands: [{ command: 'pnpm', arguments: ['run', 'build'] }],
      tarballEntries: [],
    });
  });

  it('still rejects an unknown phase and names verify', async () => {
    const { runtimeCommand } = await import('../../src/commands/runtime.js');
    await expect(runtimeCommand.parseAsync(['migrate', 'bogus', '--check'], { from: 'user' }))
      .rejects.toThrow('extract, cutover, verify, or status');
  });
});

describe('optional typescript peer', () => {
  it('is never imported statically by CLI sources (only `import type`)', async () => {
    const root = join(__dirname, '../../src');
    const offenders: string[] = [];
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
      const file = join(entry.parentPath, entry.name);
      // Template-literal scripts (generated plugin tooling) are not module imports of this package.
      const source = (await readFile(file, 'utf8')).replace(/String\.raw`[\s\S]*?`;/gu, '');
      if (/^import\s+(?!type\b)[^;]*from\s+['"]typescript['"]/mu.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
