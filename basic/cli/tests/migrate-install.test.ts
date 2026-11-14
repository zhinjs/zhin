import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execSync } = vi.hoisted(() => ({ execSync: vi.fn((_command: string, _options?: unknown) => '') }));

/** A fake installer: links every declared dependency into node_modules at `version`. */
function installEverything(version = '9.4.2', overrides: Record<string, string> = {}) {
  return (_command: string, options?: unknown) => {
    const cwd = (options as { cwd: string }).cwd;
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      mkdirSync(join(cwd, 'node_modules', name), { recursive: true });
      writeFileSync(join(cwd, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: overrides[name] ?? version }));
    }
    return '';
  };
}
vi.mock('child_process', () => ({ execSync }));
vi.mock('../src/utils/registry-version.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/registry-version.js')>(),
  npmRegistryLookup: () => ({ version: '9.4.2', dependencies: {} }),
}));

let directory: string;
let previousCwd: string;
let previousExitCode: typeof process.exitCode;

beforeEach(() => {
  vi.resetModules();
  execSync.mockReset();
  execSync.mockImplementation(installEverything());
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
      .toEqual({ 'zhin.js': '^9.4.2', '@zhin.js/tool': 'workspace:*' });
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

describe('migrate dry-run and config-version guidance', () => {
  it('a dry-run says nothing changed, keeps pins and points a v1 project to migrate instances', async () => {
    const original = JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0', '@zhin.js/agent-feature': '1.1.6' } }, null, 2);
    writeFileSync(join(directory, 'package.json'), original);
    writeFileSync(join(directory, 'zhin.config.yml'), 'plugins:\n  reminder:\n    token: synthetic-secret\n');
    writeFileSync(join(directory, 'pnpm-lock.yaml'), '');
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin', '--dry-run']);
    const output = vi.mocked(console.log).mock.calls.map(args => args.join(' ')).join('\n');
    expect(output).toContain('dry-run 结束：未写入任何文件，也未安装依赖');
    expect(output).not.toContain('迁移完成');
    expect(output).not.toContain('@zhin.js/agent-feature: 1.1.6 →');
    expect(output).toContain('zhin.js: ^1.1.0 → ^9.4.2');
    expect(output).toContain('zhin migrate instances --apply');
    expect(output).not.toContain('synthetic-secret');
    expect(execSync).not.toHaveBeenCalled();
    expect(readFileSync(join(directory, 'package.json'), 'utf8')).toBe(original);
  });

  it('help explains the config-version migration and the unrelated runtime migrate', async () => {
    const { migrateCommand } = await import('../src/commands/migrate.js');
    let help = '';
    migrateCommand.configureOutput({ writeOut: value => { help += value; } });
    migrateCommand.outputHelp();
    expect(help).toContain('configVersion');
    expect(help).toContain('zhin migrate instances --apply');
    expect(help).toContain('--include-pinned');
    expect(help).toContain('zhin runtime migrate');
  });
});

describe('migrate verifies what the install actually installed (#1250)', () => {
  it('lists each package before → after and succeeds when every declared range is installed', async () => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0' } }));
    writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    writeFileSync(join(directory, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
    mkdirSync(join(directory, 'node_modules', 'zhin.js'), { recursive: true });
    writeFileSync(join(directory, 'node_modules', 'zhin.js', 'package.json'), JSON.stringify({ name: 'zhin.js', version: '1.1.27' }));
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin']);
    const output = vi.mocked(console.log).mock.calls.map(args => args.join(' ')).join('\n');
    expect(process.exitCode).toBe(0);
    expect(output).toContain('实际安装的版本');
    expect(output).toContain('zhin.js: 1.1.27 → 9.4.2');
    expect(output).toContain('迁移完成');
    // pnpm 11 would hold the fresh release back: migrate lists it for minimumReleaseAgeExclude.
    expect(readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8')).toContain("- zhin.js@9.4.2");
  });

  it('fails with the cause when the install kept the old version (minimumReleaseAge)', async () => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0' } }));
    writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    writeFileSync(join(directory, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - left-pad\n');
    mkdirSync(join(directory, 'node_modules', 'zhin.js'), { recursive: true });
    writeFileSync(join(directory, 'node_modules', 'zhin.js', 'package.json'), JSON.stringify({ name: 'zhin.js', version: '1.1.27' }));
    execSync.mockImplementation(installEverything('9.4.2', { 'zhin.js': '1.1.27' }));
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin']);
    const output = vi.mocked(console.log).mock.calls.map(args => args.join(' ')).join('\n');
    expect(process.exitCode).toBe(1);
    expect(output).toContain('zhin.js: 1.1.27（未变化）');
    expect(output).toContain('minimumReleaseAge');
    expect(output).toContain('迁移未完成');
    expect(output).not.toContain('✅ 迁移完成');
  });

  it('names a conflicting pnpm.overrides entry as the cause', async () => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0', '@zhin.js/core': '^1.0.0' }, pnpm: { overrides: { '@zhin.js/core': 'link:../core' } } }));
    writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    execSync.mockImplementation(installEverything('9.4.2', { '@zhin.js/core': '1.0.0' }));
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin']);
    const output = vi.mocked(console.log).mock.calls.map(args => args.join(' ')).join('\n');
    expect(process.exitCode).toBe(1);
    expect(output).toContain('overrides 把 @zhin.js/core 固定为 link:../core');
  });
});

describe('migrate keeps the current scaffold layout (#1250)', () => {
  it('creates no src/plugins and no AI bootstrap files in a project without AI; output is Chinese', async () => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0' } }));
    writeFileSync(join(directory, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin', '--no-install']);
    const entries = readdirSync(directory).sort();
    expect(entries).toContain('data');
    expect(entries).toContain('plugins');
    expect(entries).not.toContain('src');
    for (const file of ['SOUL.md', 'TOOLS.md', 'AGENTS.md']) expect(entries).not.toContain(file);
    const output = vi.mocked(console.log).mock.calls.map(args => args.join(' ')).join('\n');
    expect(output).toContain('检查目录结构');
    expect(output).toContain('项目未启用 AI，不需要引导文件');
    expect(output).not.toMatch(/Ensure directory|Upgrade bootstrap|Install dependencies|Migration complete|Next steps/);
  });

  it('creates the bootstrap files for a project with AI', async () => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ dependencies: { 'zhin.js': '^1.1.0', '@zhin.js/agent': '^1.0.0' } }));
    const { migrateCommand } = await import('../src/commands/migrate.js');
    await migrateCommand.parseAsync(['node', 'zhin', '--no-install']);
    for (const file of ['SOUL.md', 'TOOLS.md', 'AGENTS.md']) expect(readdirSync(directory)).toContain(file);
  });
});
