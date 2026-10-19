import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execSync } = vi.hoisted(() => ({ execSync: vi.fn(() => '') }));
vi.mock('child_process', () => ({ execSync }));

let directory: string;
let previousCwd: string;
let previousExitCode: typeof process.exitCode;

beforeEach(() => {
  vi.resetModules();
  execSync.mockClear();
  previousCwd = process.cwd();
  previousExitCode = process.exitCode;
  process.exitCode = 0;
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'zhin-migrate-install-')));
  process.chdir(directory);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(previousCwd);
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe('migration installer admission', () => {
  it.each([{ args: [] }, { args: ['--dry-run'] }])('rejects npm-only workspace dependencies before writing or installing ($args)', async ({ args }) => {
    const original = JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0', '@zhin.js/tool': 'workspace:*' } }, null, 4) + '\n';
    writeFileSync(join(directory, 'package.json'), original);
    writeFileSync(join(directory, 'package-lock.json'), '{"lockfileVersion":3}\n');
    const { migrateCommand } = await import('../src/commands/migrate.js');
    const { logger } = await import('../src/utils/logger.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await migrateCommand.parseAsync(['node', 'zhin', ...args]);
    expect(process.exitCode).toBe(1);
    expect(execSync).not.toHaveBeenCalled();
    expect(readFileSync(join(directory, 'package.json'), 'utf8')).toBe(original);
    expect(readFileSync(join(directory, 'package-lock.json'), 'utf8')).toBe('{"lockfileVersion":3}\n');
    expect(readdirSync(directory).sort()).toEqual(['package-lock.json', 'package.json']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('npm 不支持 workspace:'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--no-install'));
  });

  it('allows an explicit manifest-only migration without selecting an installer', async () => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0', '@zhin.js/tool': 'workspace:*' } }));
    writeFileSync(join(directory, 'package-lock.json'), '{}');
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin', '--no-install']);
    expect(process.exitCode).toBe(0);
    expect(execSync).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).dependencies)
      .toEqual({ 'zhin.js': 'latest', '@zhin.js/tool': 'workspace:*' });
  });

  it.each([false, true])('preserves supported npm/pnpm installer selection (pnpm lock: %s)', async pnpm => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ dependencies: {
      'zhin.js': '^1.1.0', ...(pnpm ? { '@zhin.js/tool': 'workspace:*' } : {}),
    } }));
    writeFileSync(join(directory, 'package-lock.json'), '{}');
    if (pnpm) writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin']);
    expect(process.exitCode).toBe(0);
    expect(execSync).toHaveBeenCalledExactlyOnceWith(pnpm ? 'pnpm install --no-frozen-lockfile' : 'npm install', {
      cwd: directory, stdio: 'inherit',
    });
  });

  it.each([false, true])('previews a supported install without changing files or invoking it (pnpm lock: %s)', async pnpm => {
    const original = JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0' } }, null, 4) + '\n';
    writeFileSync(join(directory, 'package.json'), original);
    writeFileSync(join(directory, 'package-lock.json'), '{}');
    if (pnpm) writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin', '--dry-run']);
    expect(process.exitCode).toBe(0);
    expect(execSync).not.toHaveBeenCalled();
    expect(readFileSync(join(directory, 'package.json'), 'utf8')).toBe(original);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(pnpm ? 'pnpm install --no-frozen-lockfile' : 'npm install');
  });
});
