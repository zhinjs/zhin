import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDatabaseDriverAvailable, probeDatabaseConnection, redactProbeError } from '../src/probe.js';

describe('probeDatabaseConnection', () => {
  it('connects to a temporary sqlite file, runs the health query and disconnects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-probe-'));
    try {
      const result = await probeDatabaseConnection('sqlite', { filename: join(dir, 'nested', 'probe.sqlite') });
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toEqual(expect.any(Number));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('strips credentials from driver errors and always disconnects', async () => {
    const disconnect = vi.fn(async () => undefined);
    const result = await probeDatabaseConnection('mysql', { host: 'db', user: 'root', password: 'hunter2-secret' }, {
      factory: async () => ({
        connect: async () => { throw new Error('Access denied for user root using password hunter2-secret (mysql://root:hunter2-secret@db/x)'); },
        healthCheck: async () => true,
        disconnect,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('hunter2-secret');
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('reports a failed probe query and a timeout', async () => {
    expect(await probeDatabaseConnection('pg', {}, {
      factory: async () => ({ connect: async () => undefined, healthCheck: async () => false, disconnect: async () => undefined }),
    })).toEqual({ ok: false, error: 'probe query failed' });
    expect(await probeDatabaseConnection('pg', {}, {
      timeoutMs: 20,
      factory: async () => ({ connect: () => new Promise(() => undefined), healthCheck: async () => true, disconnect: async () => undefined }),
    })).toEqual({ ok: false, error: 'connection timed out' });
  });

  it('detects optional driver packages without installing them', async () => {
    expect(await isDatabaseDriverAvailable('sqlite')).toBe(true);
    expect(await isDatabaseDriverAvailable('mysql', async () => { throw new Error('missing'); })).toBe(false);
    expect(await isDatabaseDriverAvailable('pg', async () => ({}))).toBe(true);
    expect(redactProbeError(new Error('mongodb://u:p@h/x password=abc'))).toBe('mongodb://***@h/x password=***');
  });
});
