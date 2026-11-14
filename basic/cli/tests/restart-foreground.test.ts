// `zhin restart --gateway` with a foreground gateway: explain and name the replacement command,
// exit non-zero, and never touch the gateway (#1250).
import { afterEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  info: undefined as undefined | Record<string, unknown>,
  requests: [] as unknown[],
}));
vi.mock('../src/utils/gateway.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/gateway.js')>(),
  probeGateway: async () => gateway.info,
  withGateway: async (_target: unknown, use: (client: { request: (method: string) => Promise<unknown> }) => Promise<unknown>) =>
    use({ request: async (method: string) => { gateway.requests.push(method); return { state: 'running' }; } }),
  startGatewayDaemon: async () => { gateway.requests.push('start-daemon'); throw new Error('must not start a daemon'); },
}));

// No process may match: the manager comes from the gateway process (procfs), not from this shell.
const MISSING_PID = 2 ** 30;

async function restart(args: string[]): Promise<{ stderr: string; stdout: string; exitCode: number | undefined }> {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const { restartCommand } = await import('../src/commands/lifecycle.js');
    await restartCommand.parseAsync(['node', 'restart', ...args]);
    return {
      stderr: stderr.mock.calls.map(call => String(call[0])).join(''),
      stdout: stdout.mock.calls.map(call => String(call[0])).join(''),
      exitCode: process.exitCode as number | undefined,
    };
  } finally {
    process.exitCode = previousExitCode;
    stderr.mockRestore();
    stdout.mockRestore();
  }
}

describe('zhin restart --gateway on a foreground gateway', () => {
  afterEach(() => {
    gateway.info = undefined;
    gateway.requests.length = 0;
  });

  it('explains the limitation, names the replacement commands and exits non-zero', async () => {
    gateway.info = {
      gateway: { pid: MISSING_PID, mode: 'foreground', args: ['--mode', 'production', '--no-watch'], ports: [8086], origins: [] },
      instance: { state: 'running' },
      consoleInitialized: true,
    };
    const result = await restart(['--gateway']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`当前网关以前台方式运行（pid ${MISSING_PID}）`);
    expect(result.stderr).toContain('systemd / PM2');
    expect(result.stderr).toContain('Ctrl+C');
    expect(result.stderr).toContain('zhin start --foreground --mode production --no-watch');
    // Neither shut down nor re-executed.
    expect(gateway.requests).toEqual([]);
  }, 30_000);

  it('still restarts only the instance without --gateway', async () => {
    gateway.info = {
      gateway: { pid: MISSING_PID, mode: 'foreground', args: [], ports: [8086], origins: [] },
      instance: { state: 'running' },
      consoleInitialized: true,
    };
    const result = await restart([]);
    expect(result.exitCode).toBeUndefined();
    expect(gateway.requests).toHaveLength(1);
    expect(result.stdout).toContain('实例已重启');
  }, 30_000);
});
