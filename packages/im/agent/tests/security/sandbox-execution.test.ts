import { describe, expect, it, vi } from 'vitest';
import { Sandbox } from '../../src/security/sandbox.js';
import {
  DEFAULT_SANDBOX_DOCKER_IMAGE,
  buildDockerKillArgs,
  buildDockerRunArgs,
  createSandboxContainerName,
  ensureImage,
} from '../../src/security/sandbox-docker.js';

// Docker is not available in CI/unit runs: the container path is covered by argument construction only.
describe('docker sandbox arguments', () => {
  it('defaults to a supported Node image and runs the command with bash', () => {
    const args = buildDockerRunArgs('echo hi', {}, '/host/ws');
    expect(DEFAULT_SANDBOX_DOCKER_IMAGE).toBe('node:22-bookworm-slim');
    expect(args.slice(-4)).toEqual([DEFAULT_SANDBOX_DOCKER_IMAGE, 'bash', '-c', 'echo hi']);
    expect(args).not.toContain('--name');
  });

  it('names the container so it can be killed individually', () => {
    const name = createSandboxContainerName();
    const args = buildDockerRunArgs('sleep 60', {}, '/host/ws', {}, name);
    expect(args[args.indexOf('--name') + 1]).toBe(name);
    expect(args.indexOf('--name')).toBeLessThan(args.indexOf(DEFAULT_SANDBOX_DOCKER_IMAGE));
    expect(buildDockerKillArgs(name)).toEqual(['kill', name]);
    expect(name).toMatch(/^zhin-sandbox-[0-9a-f-]{36}$/);
    expect(createSandboxContainerName()).not.toBe(name);
  });
});

describe('ensureImage', () => {
  it('caches a positive image check and never caches a failure', async () => {
    const missing = vi.fn(async () => false);
    await expect(ensureImage('zhin-test/missing:1', missing)).resolves.toMatchObject({ ok: false });
    await expect(ensureImage('zhin-test/missing:1', missing)).resolves.toMatchObject({ ok: false });
    expect(missing).toHaveBeenCalledTimes(4); // inspect + pull, twice

    const present = vi.fn(async (args: readonly string[]) => args[0] === 'image');
    await expect(ensureImage('zhin-test/present:1', present)).resolves.toEqual({ ok: true });
    await expect(ensureImage('zhin-test/present:1', present)).resolves.toEqual({ ok: true });
    expect(present).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight check between concurrent callers', async () => {
    const run = vi.fn(async () => true);
    const [a, b] = await Promise.all([
      ensureImage('zhin-test/concurrent:1', run),
      ensureImage('zhin-test/concurrent:1', run),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe.skipIf(process.platform === 'win32')('sandbox process lifetime', () => {
  const runners: Array<[label: string, sandbox: () => Sandbox]> = [
    ['unrestricted runner', () => new Sandbox({ enabled: false })],
    ['soft sandbox', () => new Sandbox({ enabled: true, useDocker: 'never' })],
  ];

  it.each(runners)('%s: timeout kills the whole process group', async (_label, create) => {
    // `sleep` keeps the stdout pipe open; killing only bash would leave the call pending for 30s.
    const result = await create().execute('sleep 30 | cat', { cwd: process.cwd(), timeout: 200 });
    expect(result.timedOut).toBe(true);
    expect(result.duration).toBeLessThan(5_000);
  });

  it.each(runners)('%s: aborting the signal kills the running command', async (_label, create) => {
    const controller = new AbortController();
    const pending = create().execute('sleep 30 | cat', {
      cwd: process.cwd(),
      timeout: 20_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.duration).toBeLessThan(5_000);
  });

  it('does not run a command whose signal is already aborted to completion', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new Sandbox({ enabled: false }).execute('sleep 30', {
      cwd: process.cwd(),
      timeout: 20_000,
      signal: controller.signal,
    });
    expect(result.success).toBe(false);
    expect(result.duration).toBeLessThan(5_000);
  });
});
