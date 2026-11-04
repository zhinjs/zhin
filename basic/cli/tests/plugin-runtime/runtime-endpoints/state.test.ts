import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilityId, featureId, rootPluginId, type CapabilityId, type PersistentStatePort } from '@zhin.js/plugin-runtime';
import { type EndpointDesiredRecord } from '@zhin.js/adapter';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { PersistentEndpointRepository } from '../../../src/plugin-runtime/runtime-endpoints/state.js';

const adapterId = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'native');
const record = (id: string, desiredEnabled = false): EndpointDesiredRecord => ({ instanceId: id,
  canonicalId: `${adapterId}~${id}` as CapabilityId, endpointId: 'same-display-name', revision: 1, desiredEnabled,
  config: { id: 'same-display-name', password: 'synthetic-private-password' }, secretRefs: { token: 'synthetic-private-reference' } });

it('stores only encrypted account state, isolates Host/Adapter, restores empty/disabled records and uses one SQLite CAS winner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-endpoint-state-'));
  const config = { dialect: 'sqlite' as const, filename: join(directory, 'state.sqlite') };
  const a = createDatabaseHost(config), b = createDatabaseHost(config);
  const credentialDirectory = join(directory, 'private');
  const repository = (port: PersistentStatePort, rootId = '/host') => new PersistentEndpointRepository({ rootId, directory: credentialDirectory, state: () => port });
  try {
    await a.start(); await b.start();
    const first = repository(a.state), second = repository(b.state);
    expect(await first.load(adapterId)).toBeUndefined();
    await expect(readdir(credentialDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    const results = await Promise.allSettled([first.compareAndSet(adapterId, null, [record('one', true)]), second.compareAndSet(adapterId, null, [record('two')])]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(value => value.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
    const saved = (await first.load(adapterId))!;
    expect(saved.revision).toBe(1);
    expect(await repository(a.state, '/other-host').load(adapterId)).toBeUndefined();
    expect(await first.load(capabilityId(rootPluginId(), featureId('zhin.adapter'), 'other'))).toBeUndefined();
    const disabled = await first.compareAndSet(adapterId, 1, [record(saved.endpoints[0].instanceId)]);
    await a.stop(); await b.stop();
    const bytes = await readFile(config.filename);
    expect(bytes.includes(Buffer.from('synthetic-private-password'))).toBe(false);
    expect(bytes.includes(Buffer.from('synthetic-private-reference'))).toBe(false);
    expect(await readdir(credentialDirectory)).toEqual(['root-key.json']); // No one-file-per-mutation credential leaks.
    const reopened = createDatabaseHost(config);
    try {
      await reopened.start(); const restored = repository(reopened.state);
      expect(await restored.load(adapterId)).toEqual(disabled);
      expect((await restored.load(adapterId))!.endpoints[0].desiredEnabled).toBe(false);
      await restored.compareAndSet(adapterId, 2, []);
      expect(await repository(reopened.state).load(adapterId)).toEqual({ revision: 3, endpoints: [] });
    } finally { await reopened.stop(); }
  } finally { await a.stop(); await b.stop(); await rm(directory, { recursive: true, force: true }); }
});

it('preserves lookup/integrity/unknown outcomes without retrying or overwriting committed state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-endpoint-outcome-'));
  const read = vi.fn<PersistentStatePort['read']>(async () => undefined);
  const compareExchange = vi.fn<PersistentStatePort['compareExchange']>(async () => { throw new Error('synthetic-private'); });
  const repository = new PersistentEndpointRepository({ rootId: '/host', directory, state: () => ({ read, compareExchange }) });
  try {
    await expect(repository.compareAndSet(adapterId, null, [record('one')])).rejects.toMatchObject({ code: 'commit_unknown' });
    expect(compareExchange).toHaveBeenCalledOnce();
    const stored = compareExchange.mock.calls[0][4]!;
    read.mockResolvedValue({ revision: 'opaque-db-revision', expiresAt: null, value: stored });
    expect(await repository.load(adapterId)).toMatchObject({ revision: 1, endpoints: [record('one')] });
    await expect(repository.compareAndSet(adapterId, null, [])).rejects.toMatchObject({ code: 'conflict' });
    expect(compareExchange).toHaveBeenCalledOnce();
    const altered = { ...(stored as Record<string, unknown>), revision: 2 };
    read.mockResolvedValue({ revision: 'opaque-db-revision', expiresAt: null, value: altered as never });
    await expect(repository.load(adapterId)).rejects.toMatchObject({ code: 'integrity' });
    await expect(repository.compareAndSet(adapterId, 2, [])).rejects.toMatchObject({ code: 'integrity' });
    expect(compareExchange).toHaveBeenCalledOnce();
    read.mockRejectedValue(new Error('private-db-failure'));
    await expect(repository.load(adapterId)).rejects.toMatchObject({ code: 'unavailable' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('reports a corrupt private master key as integrity failure and never attempts a database write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-endpoint-key-integrity-'));
  const compareExchange = vi.fn<PersistentStatePort['compareExchange']>(async () => true);
  try {
    await writeFile(join(directory, 'root-key.json'), JSON.stringify({ version: 1, key: 'invalid-key' }), { mode: 0o600 });
    const repository = new PersistentEndpointRepository({ rootId: '/host', directory,
      state: () => ({ read: async () => undefined, compareExchange }) });
    await expect(repository.compareAndSet(adapterId, null, [record('one')])).rejects.toMatchObject({ code: 'integrity' });
    expect(compareExchange).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
