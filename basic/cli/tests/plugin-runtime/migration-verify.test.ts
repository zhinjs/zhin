import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MigrationVerifier, PackageCutover } from '../../src/plugin-runtime/migrate/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('MigrationVerifier', () => {
  it('builds a completed development cutover offline and enforces runtime start scripts', async () => {
    const root = await fixture(true);
    await cutover(root);
    await fakeTypeScript(root, 'exit 0');

    const report = await new MigrationVerifier().verify(root);
    expect(report).toMatchObject({
      mode: 'development',
      tarballEntries: [],
      commands: [{ command: 'pnpm', arguments: ['run', 'build'] }],
    });

  });

  it('builds and packs a publish cutover without installing dependencies', async () => {
    const root = await fixture(false);
    await writeFile(join(root, 'commands/status.ts'), 'export default {};\n');
    await cutover(root);
    await fakeTypeScript(root, [
      "printf 'export default {}\\n' > plugin.js",
      "printf 'declare const plugin: unknown; export default plugin;\\n' > plugin.d.ts",
      'mkdir -p commands',
      "printf 'export default {}\\n' > commands/status.js",
      "printf 'declare const command: unknown; export default command;\\n' > commands/status.d.ts",
      'exit 0',
    ].join('\n'));

    const report = await new MigrationVerifier().verify(root);
    expect(report.mode).toBe('publish');
    expect(report.commands).toEqual([
      { command: 'pnpm', arguments: ['run', 'build'] },
      expect.objectContaining({ command: 'pnpm', arguments: expect.arrayContaining(['pack', '--pack-destination']) }),
    ]);
    expect(report.tarballEntries).toEqual(expect.arrayContaining([
      'package/package.json',
      'package/plugin.js',
      'package/plugin.d.ts',
      'package/commands/status.js',
    ]));
  });

  it('rejects a publish tarball that omits the compiled declaration entry', async () => {
    const root = await fixture(false);
    await cutover(root);
    await fakeTypeScript(root, [
      "printf 'export default {}\\n' > plugin.js",
      'exit 0',
    ].join('\n'));

    await expect(new MigrationVerifier().verify(root)).rejects.toThrow('Tarball is missing package/plugin.d.ts');
  });
});

async function fixture(privatePackage: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-migration-verify-'));
  temporary.push(root);
  await Promise.all([
    mkdir(join(root, 'commands'), { recursive: true }),
    writeFile(join(root, 'package.json'), `${JSON.stringify({
      name: '@test/migration-verify',
      version: '1.0.0',
      private: privatePackage,
      type: 'module',
    }, null, 2)}\n`),
  ]);
  return root;
}

async function cutover(root: string): Promise<void> {
  const cutover = new PackageCutover();
  await cutover.apply(await cutover.plan(root));
}

async function fakeTypeScript(root: string, body: string): Promise<void> {
  const binary = join(root, 'node_modules/.bin/tsc');
  await mkdir(join(root, 'node_modules/.bin'), { recursive: true });
  await writeFile(binary, `#!/bin/sh\n${body}\n`);
  await chmod(binary, 0o755);
}
