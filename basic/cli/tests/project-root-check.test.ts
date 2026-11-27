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

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  gateway.runGateway.mockClear();
  daemon.start.mockClear();
  daemon.probe.mockClear();
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
    const sub = requireProjectRoot(member, { command: 'zhin start' });
    expect(sub.ok).toBe(false);
    if (!sub.ok) expect(sub.message).toContain(`项目根在 ${root}`);
    const empty = await tempDir();
    expect(locateProjectRoot(empty)).toBeUndefined();
    const none = requireProjectRoot(empty);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toContain('npm create zhin-app');
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
