import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots: string[] = [];
const args = JSON.parse(readFileSync(new URL('./windows-build-args.json', import.meta.url), 'utf8'));
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function fixture(fail = false) {
  const root = mkdtempSync(join(tmpdir(), 'zhin ci build '));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, packageManager: 'pnpm@9.0.2' }));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - basic/*\n  - packages/*\n  - plugins/*\n  - examples/*\n');
  for (const [directory, name, dependency] of [
    ['basic/foundation', 'foundation', undefined],
    ['packages/consumer', 'consumer', 'foundation'],
    ['plugins/app', 'app', 'consumer'],
    ['examples/excluded', 'excluded', undefined],
  ]) {
    const path = join(root, directory!);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify({
      name, version: '1.0.0', scripts: { build: 'node build.cjs' },
      dependencies: dependency ? { [dependency]: 'workspace:*' } : undefined,
    }));
    writeFileSync(join(path, 'build.cjs'), `
      const fs = require('node:fs');
      const root = ${JSON.stringify(root)};
      const name = ${JSON.stringify(name)};
      const dependency = ${JSON.stringify(dependency ?? null)};
      if (name === 'excluded') process.exit(99);
      if (dependency && !fs.existsSync(root + '/' + dependency + '.done')) process.exit(98);
      const lock = root + '/active';
      fs.closeSync(fs.openSync(lock, 'wx'));
      fs.appendFileSync(root + '/events', name + ':start\\n');
      setTimeout(() => {
        fs.unlinkSync(lock);
        if (${fail} && name === 'consumer') process.exit(7);
        fs.writeFileSync(root + '/' + name + '.done', 'done');
        fs.appendFileSync(root + '/events', name + ':done\\n');
      }, 50);
    `);
  }
  const result = process.platform === 'win32'
    ? spawnSync('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('./build-windows.ps1', import.meta.url)), '-ProjectRoot', root], {
      encoding: 'utf8', timeout: 30_000,
    })
    : spawnSync('pnpm', args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
  expect(result.error).toBeUndefined();
  expect(existsSync(join(root, 'events')), result.stdout + result.stderr).toBe(true);
  const events = readFileSync(join(root, 'events'), 'utf8').trim().split('\n');
  return { root, result, events };
}

describe('Windows CI build orchestration', () => {
  it('builds dependency-first without overlap and excludes examples', () => {
    const { result, events } = fixture();
    expect(result.stdout + result.stderr).not.toContain('ERR_PNPM');
    expect(result.status).toBe(0);
    expect(events).toEqual(['foundation:start', 'foundation:done', 'consumer:start', 'consumer:done', 'app:start', 'app:done']);
  }, 30_000);

  it('preserves a build failure, never retries it, and stops its dependents', () => {
    const { root, result, events } = fixture(true);
    expect(result.status).toBe(7);
    expect(events).toEqual(['foundation:start', 'foundation:done', 'consumer:start']);
    if (process.platform === 'win32') {
      const diagnostics = JSON.parse(readFileSync(join(root, '.tmp/ci/windows-build-resources.json'), 'utf8'));
      expect(diagnostics.exitCode).toBe(7);
      expect(diagnostics.samples.length).toBeGreaterThan(0);
    }
  }, 30_000);
});
