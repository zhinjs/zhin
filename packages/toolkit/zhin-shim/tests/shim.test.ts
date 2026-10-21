import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../../..');
const shimBin = join(packageRoot, 'bin/zhin.js');
const cliBin = join(repoRoot, 'basic/cli/bin/zhin.js');
const cliBuilt = existsSync(join(repoRoot, 'basic/cli/lib/cli.js'));

function run(bin: string, args: string[]) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: 30_000,
  });
}

describe('zhin (alias of @zhin.js/cli)', () => {
  it('publishes only bin/ and depends on the workspace CLI', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    expect(manifest.name).toBe('zhin');
    expect(manifest.files).toEqual(['bin']);
    expect(manifest.bin).toEqual({ zhin: './bin/zhin.js' });
    expect(manifest.dependencies).toEqual({ '@zhin.js/cli': 'workspace:^' });
  });

  it('resolves the zhin bin declared by @zhin.js/cli', () => {
    // Plain Node: the vitest module runner has no import.meta.resolve.
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      "const { findCliBin } = await import('./bin/resolve-cli.js'); process.stdout.write(findCliBin());",
    ], { cwd: packageRoot, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(realpathSync(result.stdout)).toBe(realpathSync(cliBin));
  });

  it.skipIf(!cliBuilt)('forwards argv, output and exit code', () => {
    for (const args of [['--version'], ['--help'], ['definitely-not-a-command']]) {
      const viaShim = run(shimBin, args);
      const direct = run(cliBin, args);
      expect(viaShim.status, args.join(' ')).toBe(direct.status);
      expect(viaShim.stdout).toBe(direct.stdout);
      expect(viaShim.stderr).toBe(direct.stderr);
    }
    expect(run(shimBin, ['definitely-not-a-command']).status).not.toBe(0);
  });

  describe('project-local @zhin.js/cli', () => {
    const resolveFrom = (cwd: string) => spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `const { findCliBin } = await import(${JSON.stringify(join(packageRoot, 'bin/resolve-cli.js'))}); process.stdout.write(findCliBin());`,
    ], { cwd, encoding: 'utf8' });

    function fakeProject(exportsField?: unknown) {
      const dir = mkdtempSync(join(tmpdir(), 'zhin-shim-'));
      const cli = join(dir, 'node_modules/@zhin.js/cli');
      mkdirSync(join(cli, 'bin'), { recursive: true });
      writeFileSync(join(cli, 'package.json'), JSON.stringify({
        name: '@zhin.js/cli', version: '0.0.1-local', type: 'module', bin: { zhin: './bin/zhin.js' },
        ...(exportsField ? { exports: exportsField } : {}),
      }));
      writeFileSync(join(cli, 'bin/zhin.js'), '');
      return { dir, bin: join(cli, 'bin/zhin.js') };
    }

    it('prefers the CLI installed in the working directory over the shim dependency', () => {
      const project = fakeProject();
      try {
        const result = resolveFrom(project.dir);
        expect(result.stderr).toBe('');
        expect(realpathSync(result.stdout)).toBe(realpathSync(project.bin));
      } finally { rmSync(project.dir, { recursive: true, force: true }); }
    });

    it('finds a project CLI whose exports hide package.json', () => {
      const project = fakeProject({ '.': './bin/zhin.js' });
      try {
        const result = resolveFrom(project.dir);
        expect(result.stderr).toBe('');
        expect(realpathSync(result.stdout)).toBe(realpathSync(project.bin));
      } finally { rmSync(project.dir, { recursive: true, force: true }); }
    });

    it('falls back to the shim dependency when the project has no CLI', () => {
      const empty = mkdtempSync(join(tmpdir(), 'zhin-shim-empty-'));
      try {
        const result = resolveFrom(empty);
        expect(result.stderr).toBe('');
        expect(realpathSync(result.stdout)).toBe(realpathSync(cliBin));
      } finally { rmSync(empty, { recursive: true, force: true }); }
    });
  });
});
