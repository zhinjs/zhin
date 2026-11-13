import { afterEach, describe, expect, it, vi } from 'vitest';

describe.skipIf(process.platform === 'win32')("Sandbox useDocker: 'auto' host fallback (ADR 0059 §7)", () => {
  afterEach(() => {
    vi.doUnmock('@zhin.js/logger');
    vi.doUnmock('../../src/security/sandbox-docker.js');
    vi.resetModules();
  });

  async function load(warn: (message: string) => void) {
    vi.resetModules();
    vi.doMock('@zhin.js/logger', async () => {
      const actual = await vi.importActual<typeof import('@zhin.js/logger')>('@zhin.js/logger');
      return {
        ...actual,
        getLogger: (name: string) => new Proxy(actual.getLogger(name), {
          get: (target, prop, receiver) => (prop === 'warn' ? warn : Reflect.get(target, prop, receiver)),
        }),
      };
    });
    vi.doMock('../../src/security/sandbox-docker.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/security/sandbox-docker.js')>('../../src/security/sandbox-docker.js');
      return { ...actual, isDockerAvailable: () => false, executeInDocker: async () => { throw new Error('docker: command not found'); } };
    });
    return import('../../src/security/sandbox.js');
  }

  it('warns once that the command runs on the host without the .zhin/ hiding', async () => {
    const warn = vi.fn();
    const { Sandbox } = await load(warn);
    const sandbox = new Sandbox({ enabled: true, useDocker: 'auto' });
    expect((await sandbox.execute('echo hi')).stdout.trim()).toBe('hi');
    await new Sandbox({ enabled: true, useDocker: 'auto' }).execute('true');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/fell back to host execution.*\.zhin\//);
  });

  it("does not fall back (nor warn) with useDocker: 'always'", async () => {
    const warn = vi.fn();
    const { Sandbox } = await load(warn);
    const result = await new Sandbox({ enabled: true, useDocker: 'always', workingDirectory: process.cwd() }).execute('echo hi');
    expect(result.blocked).toBe(true);
    expect(result.stdout).not.toContain('hi');
    expect(warn).not.toHaveBeenCalled();
  });
});
