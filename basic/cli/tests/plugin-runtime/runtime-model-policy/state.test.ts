import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { PersistentRuntimePolicyRepository } from '../../../src/plugin-runtime/runtime-model-policy/state.js';
import type { PersistentStatePort } from '@zhin.js/plugin-runtime';

it('atomically replaces only one SQLite policy revision, isolates Hosts and restores after reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-policy-sqlite-'));
  const config = { dialect: 'sqlite' as const, filename: join(directory, 'state.sqlite') };
  const a = createDatabaseHost(config), b = createDatabaseHost(config);
  try {
    await a.start(); await b.start();
    const repository = (port: PersistentStatePort, rootId = '/host') => new PersistentRuntimePolicyRepository({ rootId, hostOwnerId: 'host-owner', state: () => port });
    const first = repository(a.state), second = repository(b.state);
    expect(await first.read()).toEqual({ revision: 0, refsOverride: { defaults: {} } });
    const results = await Promise.all([
      first.compareExchange(0, { defaults: { chat: 'first' } }),
      second.compareExchange(0, { defaults: { chat: 'second' } }),
    ]);
    expect(results.map(result => result.kind).sort()).toEqual(['conflict', 'updated']);
    const saved = await second.read(); expect(saved.revision).toBe(1);
    expect(await repository(a.state, '/other-host').read()).toEqual({ revision: 0, refsOverride: { defaults: {} } });
    await a.stop(); await b.stop();
    const reopened = createDatabaseHost(config);
    try {
      await reopened.start(); const restored = repository(reopened.state);
      expect(await restored.read()).toEqual(saved);
      expect(await restored.compareExchange(0, {})).toMatchObject({ kind: 'conflict', actualRevision: 1 });
      expect(await restored.compareExchange(1, {})).toEqual({ kind: 'updated', snapshot: { revision: 2, refsOverride: { defaults: {} } } });
      expect(await restored.read()).toEqual({ revision: 2, refsOverride: { defaults: {} } });
    } finally { await reopened.stop(); }
  } finally { await a.stop(); await b.stop(); await rm(directory, { recursive: true, force: true }); }
});

it('distinguishes no persistence, lookup failure, corrupt data and an unknown commit without retries', async () => {
  const options = { rootId: '/host', hostOwnerId: 'owner' };
  const unavailable = new PersistentRuntimePolicyRepository({ ...options, state: () => undefined });
  await expect(unavailable.read()).rejects.toMatchObject({ code: 'unavailable' });
  await expect(unavailable.compareExchange(0, {})).rejects.toMatchObject({ code: 'unavailable' });
  const read = vi.fn<PersistentStatePort['read']>(async () => { throw new Error('synthetic-private-cause'); });
  const compareExchange = vi.fn<PersistentStatePort['compareExchange']>(async () => { throw new Error('synthetic-private-cause'); });
  const repository = new PersistentRuntimePolicyRepository({ ...options, state: () => ({ read, compareExchange }) });
  await expect(repository.read()).rejects.toMatchObject({ code: 'unavailable' });
  expect(compareExchange).not.toHaveBeenCalled();
  read.mockResolvedValue({ revision: 'db-revision', value: { version: 9 }, expiresAt: null });
  await expect(repository.read()).rejects.toMatchObject({ code: 'integrity' });
  await expect(repository.compareExchange(0, {})).rejects.toMatchObject({ code: 'integrity' });
  expect(compareExchange).not.toHaveBeenCalled();
  read.mockResolvedValue(undefined);
  await expect(repository.compareExchange(0, {})).rejects.toMatchObject({ code: 'commit_unknown', message: 'Runtime model policy: commit_unknown' });
  expect(compareExchange).toHaveBeenCalledOnce();
});

it('does not erase an acknowledged-in-storage write when compareExchange loses its result', async () => {
  let row: Awaited<ReturnType<PersistentStatePort['read']>>;
  const compareExchange = vi.fn<PersistentStatePort['compareExchange']>(async (_owner, _scope, _key, _revision, value, expiresAt) => {
    row = { revision: 'committed-db-revision', value: value!, expiresAt }; throw new Error('reply lost after commit');
  });
  const port: PersistentStatePort = { read: async () => row, compareExchange };
  const repository = new PersistentRuntimePolicyRepository({ rootId: '/host', hostOwnerId: 'owner', state: () => port });
  await expect(repository.compareExchange(0, { defaults: { chat: 'selected' } })).rejects.toMatchObject({ code: 'commit_unknown' });
  expect(await repository.read()).toEqual({ revision: 1, refsOverride: { defaults: { chat: 'selected' } } });
  expect(compareExchange).toHaveBeenCalledOnce();
});
