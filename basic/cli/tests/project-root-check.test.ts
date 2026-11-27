// #1250 start-no-project-check / console-cli-store-in-cwd: `zhin start`, `zhin runtime start`,
// `zhin restart` and `zhin console …` locate the project root before touching `.zhin/`.
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({ runGateway: vi.fn(async () => 0) }));
vi.mock('@zhin.js/gateway/server', async importOriginal => ({
  ...await importOriginal<typeof import('@zhin.js/gateway/server')>(),
  runGateway: gateway.runGateway,
}));

const daemon = vi.hoisted(() => ({ start: vi.fn(), probe: vi.fn(async () => undefined) }));
vi.mock('../src/utils/gateway.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/gateway.js')>(),
  probeGateway: daemon.probe,
  startGatewayDaemon: daemon.start,
}));

const instance = vi.hoisted(() => ({ run: vi.fn(async () => undefined) }));
vi.mock('../src/commands/runtime-instance.js', () => ({ runProjectInstance: instance.run }));

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  gateway.runGateway.mockClear();
  daemon.start.mockClear();
  daemon.probe.mockClear();
  instance.run.mockClear();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = fs.realpathSync(await mkdtemp(path.join(tmpdir(), 'zprc-')));
  dirs.push(dir);
  return dir;
}

/** A project root with a `plugins/x` member package inside. */
async function projectWithMember(): Promise<{ root: string; member: string }> {
  const root = await tempDir();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', private: true, dependencies: { 'zhin.js': '^1.0.0' } }));
  await writeFile(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  const member = path.join(root, 'plugins', 'x');
  await mkdir(member, { recursive: true });
  await writeFile(path.join(member, 'package.json'), JSON.stringify({ name: 'x', peerDependencies: { 'zhin.js': '*' } }));
  return { root, member };
}

function inDirectory(dir: string): { stderr: () => string; stdout: () => string } {
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return {
    stderr: () => err.mock.calls.map(call => String(call[0])).join(''),
    stdout: () => out.mock.calls.map(call => String(call[0])).join(''),
  };
}

describe('project root resolution', () => {
  it('locates the root from a member directory and reports none for an unrelated directory', async () => {
    const { locateProjectRoot, requireProjectRoot } = await import('../src/utils/project-root.js');
    const { root, member } = await projectWithMember();
    expect(locateProjectRoot(member)).toBe(root);
    expect(requireProjectRoot(root)).toEqual({ ok: true, root });
    expect(requireProjectRoot(member, { from: 'nearest' })).toEqual({ ok: true, root });
    const sub = requireProjectRoot(member, { command: ['zhin', 'start'] });
    expect(sub.ok).toBe(false);
    if (!sub.ok) expect(sub.message).toContain(`项目根在 ${root}`);
    const empty = await tempDir();
    expect(locateProjectRoot(empty)).toBeUndefined();
    const none = requireProjectRoot(empty);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toContain('npm create zhin-app');
  });
});

describe('project root resolution: parents, workspaces, package.json (#1250 review)', () => {
  const zhinPackage = (name: string, field = 'dependencies'): string => JSON.stringify({ name, private: true, [field]: { 'zhin.js': '^1.0.0' } });

  it('a config.json in a parent directory does not take over a project below it', async () => {
    const { locateProjectRoot, requireProjectRoot } = await import('../src/utils/project-root.js');
    const parent = await tempDir();
    await writeFile(path.join(parent, 'config.json'), '{}');
    const project = path.join(parent, 'proj');
    await mkdir(project);
    await writeFile(path.join(project, 'package.json'), zhinPackage('proj'));
    expect(locateProjectRoot(project)).toBe(project);
    expect(requireProjectRoot(project)).toEqual({ ok: true, root: project });
    // The parent (config.json, no package.json) is no project either.
    expect(locateProjectRoot(parent)).toBeUndefined();
  });

  it('a parent with two config files neither throws nor takes over the project below it', async () => {
    const { locateProjectRoot, requireProjectRoot } = await import('../src/utils/project-root.js');
    const parent = await tempDir();
    await writeFile(path.join(parent, 'zhin.config.yml'), 'plugins: {}\n');
    await writeFile(path.join(parent, 'config.json'), '{}');
    const project = path.join(parent, 'proj');
    await mkdir(project);
    await writeFile(path.join(project, 'package.json'), zhinPackage('proj'));
    expect(() => locateProjectRoot(project)).not.toThrow();
    expect(requireProjectRoot(project)).toEqual({ ok: true, root: project });
    expect(locateProjectRoot(path.join(parent))).toBeUndefined();
  });

  it('two config files at the project root are reported, not thrown', async () => {
    const { requireProjectRoot } = await import('../src/utils/project-root.js');
    const root = await tempDir();
    await writeFile(path.join(root, 'package.json'), zhinPackage('bot'));
    await writeFile(path.join(root, 'zhin.config.yml'), 'plugins: {}\n');
    await writeFile(path.join(root, 'config.yml'), 'plugins: {}\n');
    const check = requireProjectRoot(root);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toContain('同时有多个配置文件（config.yml, zhin.config.yml）');
  });

  it('a workspace member that depends on zhin.js resolves to the workspace root', async () => {
    const { locateProjectRoot } = await import('../src/utils/project-root.js');
    const root = await tempDir();
    await writeFile(path.join(root, 'package.json'), zhinPackage('bot'));
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n");
    const member = path.join(root, 'plugins', 'x');
    await mkdir(path.join(member, 'src'), { recursive: true });
    await writeFile(path.join(member, 'package.json'), zhinPackage('x', 'devDependencies'));
    expect(locateProjectRoot(member)).toBe(root);
    expect(locateProjectRoot(path.join(member, 'src'))).toBe(root);
    // Not a member (outside the globs): the nearer package is its own project.
    const other = path.join(root, 'tools', 'y');
    await mkdir(other, { recursive: true });
    await writeFile(path.join(other, 'package.json'), zhinPackage('y'));
    expect(locateProjectRoot(other)).toBe(other);
  });

  it('a member excluded by a ! glob is its own project', async () => {
    const { locateProjectRoot } = await import('../src/utils/project-root.js');
    const root = await tempDir();
    await writeFile(path.join(root, 'package.json'), zhinPackage('bot'));
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/**'\n  - '!plugins/skip'\n");
    const skipped = path.join(root, 'plugins', 'skip');
    await mkdir(skipped, { recursive: true });
    await writeFile(path.join(skipped, 'package.json'), zhinPackage('skip'));
    expect(locateProjectRoot(skipped)).toBe(skipped);
    const deep = path.join(root, 'plugins', 'group', 'deep');
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, 'package.json'), zhinPackage('deep'));
    expect(locateProjectRoot(deep)).toBe(root);
  });

  it('a directory with only zhin.config.yml (no package.json) is not a project, and says what is missing', async () => {
    const { locateProjectRoot, requireProjectRoot } = await import('../src/utils/project-root.js');
    const dir = await tempDir();
    await writeFile(path.join(dir, 'zhin.config.yml'), 'plugins: {}\n');
    expect(locateProjectRoot(dir)).toBeUndefined();
    const check = requireProjectRoot(dir, { from: 'nearest' });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toContain('缺少 package.json');
  });

  it('quotes the root and keeps the arguments in the suggested command', async () => {
    const { rerunAtRoot, shellQuote } = await import('../src/utils/project-root.js');
    expect(shellQuote('/srv/bot')).toBe('/srv/bot');
    expect(shellQuote("/home/me/my bot's", 'linux')).toBe(`'/home/me/my bot'\\''s'`);
    expect(shellQuote('C:\\My Bots\\a', 'win32')).toBe('"C:\\My Bots\\a"');
    expect(rerunAtRoot('/x y', ['zhin', 'start', '--foreground'])).toBe(
      process.platform === 'win32' ? 'cd "/x y" && zhin start --foreground' : "cd '/x y' && zhin start --foreground");
  });
});

describe('zhin start outside a project (#1250 start-no-project-check)', () => {
  it('runtime start refuses an unrelated directory without starting the gateway or writing .zhin/', async () => {
    const empty = await tempDir();
    const io = inDirectory(empty);
    const { runtimeCommand } = await import('../src/commands/runtime.js');
    await runtimeCommand.parseAsync(['start'], { from: 'user' });
    expect(gateway.runGateway).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(io.stderr()).toContain('npm create zhin-app');
    expect(fs.existsSync(path.join(empty, '.zhin'))).toBe(false);
  });

  it('runtime start from a sub-directory names the project root', async () => {
    const { root, member } = await projectWithMember();
    const io = inDirectory(member);
    const { runtimeCommand } = await import('../src/commands/runtime.js');
    await runtimeCommand.parseAsync(['start', '--once'], { from: 'user' });
    expect(gateway.runGateway).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(io.stderr()).toContain(`项目根在 ${root}`);
    expect(fs.existsSync(path.join(member, '.zhin'))).toBe(false);
  });

  it('runtime start at the project root still starts the gateway', async () => {
    const { root } = await projectWithMember();
    inDirectory(root);
    const { runtimeCommand } = await import('../src/commands/runtime.js');
    await runtimeCommand.parseAsync(['start'], { from: 'user' });
    expect(gateway.runGateway).toHaveBeenCalledWith(expect.objectContaining({ root }));
  });

  it('zhin start (background) refuses an unrelated directory before probing or spawning', async () => {
    const empty = await tempDir();
    const io = inDirectory(empty);
    const { startCommand } = await import('../src/commands/lifecycle.js');
    await startCommand.parseAsync([], { from: 'user' });
    expect(daemon.start).not.toHaveBeenCalled();
    expect(daemon.probe).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(io.stderr()).toContain('npm create zhin-app');
    expect(fs.existsSync(path.join(empty, '.zhin'))).toBe(false);
  });

  it('zhin start --foreground from a sub-directory names the quoted root and keeps the arguments', async () => {
    const parent = await tempDir();
    const root = path.join(parent, 'my bot');
    await mkdir(root);
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', private: true, dependencies: { 'zhin.js': '^1.0.0' } }));
    const member = path.join(root, 'plugins', 'x');
    await mkdir(member, { recursive: true });
    const io = inDirectory(member);
    const { startCommand } = await import('../src/commands/lifecycle.js');
    await startCommand.parseAsync(['--foreground', '--once'], { from: 'user' });
    expect(gateway.runGateway).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    const quoted = process.platform === 'win32' ? `"${root}"` : `'${root}'`;
    expect(io.stderr()).toContain(`cd ${quoted} && zhin start --foreground --once`);
  });

  it('the supervised instance child (ZHIN_RUNTIME_CHILD) skips the check and runs the instance', async () => {
    const empty = await tempDir();
    inDirectory(empty);
    vi.stubEnv('ZHIN_RUNTIME_CHILD', '1');
    const { runtimeCommand } = await import('../src/commands/runtime.js');
    await runtimeCommand.parseAsync(['start'], { from: 'user' });
    expect(instance.run).toHaveBeenCalledTimes(1);
    expect(gateway.runGateway).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    const { startCommand } = await import('../src/commands/lifecycle.js');
    await startCommand.parseAsync([], { from: 'user' });
    expect(instance.run).toHaveBeenCalledTimes(2);
    expect(daemon.probe).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('zhin restart from a sub-directory names the project root instead of saying no gateway runs', async () => {
    const { root, member } = await projectWithMember();
    const io = inDirectory(member);
    const { restartCommand } = await import('../src/commands/lifecycle.js');
    await restartCommand.parseAsync([], { from: 'user' });
    expect(daemon.probe).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(io.stderr()).toContain(`项目根在 ${root}`);
    expect(io.stdout()).not.toContain('网关未运行');
  });
});

describe('zhin console from a sub-directory (#1250 console-cli-store-in-cwd, plan a)', () => {
  it('opens the project root gateway.db, prints its path and leaves the sub-directory alone', async () => {
    const { root, member } = await projectWithMember();
    const io = inDirectory(member);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { consoleCommand } = await import('../src/commands/console.js');
    await consoleCommand.parseAsync(['user', 'list'], { from: 'user' });
    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(member, '.zhin'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.zhin', 'gateway.db'))).toBe(true);
    expect(io.stderr()).toContain(path.join(root, '.zhin', 'gateway.db'));
    expect(log.mock.calls.flat().join('\n')).toContain('还没有用户');
  });

  it('refuses a directory outside any project without creating .zhin/', async () => {
    const empty = await tempDir();
    const io = inDirectory(empty);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { consoleCommand } = await import('../src/commands/console.js');
    await consoleCommand.parseAsync(['user', 'list'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(path.join(empty, '.zhin'))).toBe(false);
    expect(io.stderr()).toContain('npm create zhin-app');
  });
});
