import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeInDocker, stopContainer, type DockerCli } from '../../src/security/sandbox-docker.js';
import { Sandbox } from '../../src/security/sandbox.js';
import { SandboxBashExecutionPort } from '../../src/plugin-runtime/native-bash-tool.js';

/**
 * A fake docker whose container outlives the `docker run` CLI: killing the CLI closes it at once,
 * but the "container" (an interval writing BOT.md into the workspace) only dies `killDelayMs`
 * after `docker kill` / `docker rm -f`, and never when `killable` is false.
 */
function fakeDocker(workspace: string, options: { killDelayMs?: number; killable?: boolean; cliExit?: { code: number | null; signal?: string | null; afterMs: number }; spawnError?: boolean } = {}) {
  let alive = false;
  let writer: NodeJS.Timeout | undefined;
  const calls: string[][] = [];
  const die = () => { alive = false; clearInterval(writer); };
  const docker: DockerCli = {
    spawnRun: () => {
      alive = true;
      // `while :; do [ -e BOT.md ] || echo x > BOT.md; sleep 0.01; done`
      writer = setInterval(() => { if (alive && !existsSync(join(workspace, 'BOT.md'))) writeFileSync(join(workspace, 'BOT.md'), 'take over'); }, 2);
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      Object.assign(child, {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => {
          setImmediate(() => options.spawnError ? child.emit('error', new Error('docker CLI crashed')) : child.emit('close', null, 'SIGKILL'));
          return true;
        },
      });
      // The CLI exits on its own (not by our stop): a signal or a daemon error.
      if (options.cliExit) {
        const exit = options.cliExit;
        setTimeout(() => child.emit('close', exit.code, exit.signal ?? null), exit.afterMs);
      }
      return child;
    },
    run: async (args) => {
      calls.push([...args]);
      if (args[0] === 'image') return { code: 0, stderr: '' };
      if ((args[0] === 'kill' || args[0] === 'rm') && options.killable !== false && alive) {
        setTimeout(die, options.killDelayMs ?? 30);
        return { code: 0, stderr: '' };
      }
      if (args[0] === 'inspect') return alive ? { code: 0, stderr: '' } : { code: 1, stderr: 'Error: No such object: x' };
      return { code: 0, stderr: '' };
    },
  };
  return { docker, calls, isAlive: () => alive, stop: die };
}

const dirs: string[] = [];
const stops: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const stop of stops.splice(0)) stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zhin-docker-stop-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'AGENTS.md'), 'developer rules');
  return dir;
}

// #1266: quarantine must not race a container that survives the killed `docker run` CLI.
describe('docker stop confirmation', () => {
  it('settles a timed-out run only after the container is confirmed gone', async () => {
    const dir = workspace();
    const fake = fakeDocker(dir, { killDelayMs: 40 });
    stops.push(fake.stop);
    const result = await executeInDocker('loop', { workingDirectory: dir, timeout: 20, dockerImage: 'img:1' }, { docker: fake.docker, stopConfirmMs: 2_000 });
    expect(result.timedOut).toBe(true);
    expect(fake.isAlive()).toBe(false);
    expect(result.containerStopConfirmed).toBe(true);
    expect(fake.calls.some(args => args[0] === 'rm' && args[1] === '-f')).toBe(true);
  });

  it('reports an unconfirmed stop instead of claiming the container is gone', async () => {
    const dir = workspace();
    const fake = fakeDocker(dir, { killable: false });
    stops.push(fake.stop);
    const result = await executeInDocker('loop', { workingDirectory: dir, timeout: 20, dockerImage: 'img:1' }, { docker: fake.docker, stopConfirmMs: 100 });
    expect(result.containerStopConfirmed).toBe(false);
    expect(result.containerStopped).toBeInstanceOf(Promise);
    expect(fake.isAlive()).toBe(true);
  });

  it('only counts "no such container" as confirmation, not a failing docker CLI', async () => {
    expect(await stopContainer({ run: async () => null }, 'c', 50)).toBe(false);
    expect(await stopContainer({ run: async () => ({ code: 1, stderr: 'Cannot connect to the Docker daemon' }) }, 'c', 50)).toBe(false);
    expect(await stopContainer({ run: async (args) => args[0] === 'inspect' ? { code: 1, stderr: 'Error: No such container: c' } : { code: 0, stderr: '' } }, 'c', 50)).toBe(true);
  });

  it('quarantines a BOT.md the surviving container keeps recreating only after the kill is confirmed', async () => {
    const dir = workspace();
    const fake = fakeDocker(dir, { killDelayMs: 60 });
    stops.push(fake.stop);
    vi.spyOn(Sandbox.prototype, 'execute').mockImplementation((command, options) => executeInDocker(command, {
      workingDirectory: dir, timeout: options?.timeout ?? 20, dockerImage: 'img:1',
    }, { docker: fake.docker, stopConfirmMs: 2_000, ...(options?.signal ? { signal: options.signal } : {}) }));
    const port = new SandboxBashExecutionPort();
    const result = await port.execute({
      command: 'while :; do [ -e BOT.md ] || echo x > BOT.md; sleep 0.01; done',
      cwd: dir, timeoutMs: 20, signal: new AbortController().signal,
      policy: {
        permissions: [], unattended: false, network: { enabled: false },
        shell: { security: 'full', approvalMode: 'bypass', isolation: 'required' },
        filesystem: { workspaceRoot: dir, access: 'workspace-write' },
      },
    });
    expect(fake.isAlive()).toBe(false);
    expect(result.quarantined?.map(entry => entry.name)).toEqual(['BOT.md']);
    expect(existsSync(join(dir, 'BOT.md'))).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(existsSync(join(dir, 'BOT.md'))).toBe(false);
  });

  it('confirms the container after a CLI exit we did not cause (signal or daemon error)', async () => {
    for (const cliExit of [{ code: null, signal: 'SIGTERM', afterMs: 5 }, { code: 125, afterMs: 5 }]) {
      const dir = workspace();
      const fake = fakeDocker(dir, { killDelayMs: 20, cliExit });
      stops.push(fake.stop);
      const result = await executeInDocker('loop', { workingDirectory: dir, timeout: 5_000, dockerImage: 'img:1' }, { docker: fake.docker, stopConfirmMs: 2_000 });
      expect(result.timedOut).toBe(false);
      expect(result.containerStopConfirmed).toBe(true);
      expect(fake.isAlive()).toBe(false);
    }
    // A clean exit of the container needs no stop.
    const dir = workspace();
    const fake = fakeDocker(dir, { cliExit: { code: 0, afterMs: 5 } });
    stops.push(fake.stop);
    const clean = await executeInDocker('true', { workingDirectory: dir, timeout: 5_000, dockerImage: 'img:1' }, { docker: fake.docker });
    expect(clean).not.toHaveProperty('containerStopConfirmed');
  });

  it('confirms the container when the CLI errors after a stop request, and reports when it cannot', async () => {
    const dir = workspace();
    const fake = fakeDocker(dir, { killable: false, spawnError: true });
    stops.push(fake.stop);
    const result = await executeInDocker('loop', { workingDirectory: dir, timeout: 20, dockerImage: 'img:1' }, { docker: fake.docker, stopConfirmMs: 100 });
    expect(result.stderr).toContain('docker CLI crashed');
    expect(result.containerStopConfirmed).toBe(false);
  });
});
