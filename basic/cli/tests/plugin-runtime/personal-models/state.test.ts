import { describe, expect, it, vi } from 'vitest';
import {
  PersonalSessionService, PersonalSessionRepositoryIntegrityError, personalSessionIdentity, personalSessionOwnerId,
} from '@zhin.js/agent/personal-session';
import type { ModelCatalogConfig } from '@zhin.js/ai/model-catalog';
import type { JsonValue, PersistentStatePort, StateRecord } from '@zhin.js/plugin-runtime';
import { PersonalModelStateStore, PersonalModelStateIntegrityError, PersonalModelStateUnavailableError } from '../../../src/plugin-runtime/personal-models/state.js';

function identity(subjectId = 'alice') {
  return personalSessionIdentity({ rootId: '/host', platform: 'qq', endpoint: 'account', subjectId,
    conversation: { endpoint: { adapter: 'root', id: 'root\0zhin.adapter\0qq' }, kind: 'group', id: 'group' } });
}
function catalog(ownerId: string): ModelCatalogConfig {
  return { connections: { c: { id: 'c', ownerId, revision: 1, sdk: 'openai', secretRef: 'opaque-secret-ref' } },
    models: { m: { id: 'm', connectionId: 'c', model: 'model', capabilities: { input: ['text'] } } },
    presets: { chat: { id: 'chat', modelId: 'm' } } };
}
function persistence() {
  const rows = new Map<string, StateRecord>();
  let sequence = 0;
  const port: PersistentStatePort = {
    read: vi.fn(async (_owner, _scope, key) => rows.get(key)),
    compareExchange: vi.fn(async (_owner, _scope, key, revision, value, expiresAt) => {
      if (rows.get(key)?.revision !== revision) return false;
      if (value === undefined) rows.delete(key);
      else rows.set(key, { revision: String(++sequence), value: JSON.parse(JSON.stringify(value)) as JsonValue, expiresAt });
      return true;
    }),
  };
  return { port, rows };
}

describe('PersonalModelStateStore persistent CAS adapter', () => {
  it('persists Session settings across service/repository instances and restores inheritance', async () => {
    const { port, rows } = persistence();
    const own = identity();
    const access = { address: own.address, owner: own.owner };
    const first = new PersonalSessionService(new PersonalModelStateStore(() => port));
    expect((await first.read(access)).revision).toBe(0);
    const selected = await first.select({ ...access, expectedRevision: 0, selection: { kind: 'preset', presetId: 'chat' } });
    const afterRestart = new PersonalSessionService(new PersonalModelStateStore(() => port));
    expect(await afterRestart.read(access)).toEqual(selected);
    const inherited = await afterRestart.select({ ...access, expectedRevision: 1, selection: { kind: 'inherit' } });
    expect(inherited).toMatchObject({ revision: 2, selection: { kind: 'inherit' } });
    expect([...rows.values()].every(record => record.expiresAt === null)).toBe(true);
    expect((await afterRestart.read({ address: identity('bob').address, owner: identity('bob').owner })).revision).toBe(0);
  });

  it('commits exactly one competing Session CAS without retrying the losing write', async () => {
    const { port } = persistence();
    const own = identity();
    const results = await Promise.all([1, 2].map(() => new PersonalModelStateStore(() => port).compareAndSet(0,
      { identity: own, revision: 1, selection: { kind: 'inherit' } })));
    expect(results.map(result => result.kind).sort()).toEqual(['conflict', 'updated']);
    expect(results.find(result => result.kind === 'conflict')).toEqual({ kind: 'conflict', actualRevision: 1 });
    expect(port.compareExchange).toHaveBeenCalledTimes(2);
  });

  it('persists detached catalog metadata under full authenticated owner hashes', async () => {
    const { port } = persistence();
    const store = new PersonalModelStateStore(() => port);
    const owner = identity().owner;
    const ownerId = personalSessionOwnerId(owner);
    const value = catalog(ownerId);
    const selected = await store.compareExchangeCatalog(ownerId, 0, value);
    expect(selected.kind).toBe('updated');
    expect(await new PersonalModelStateStore(() => port).loadCatalog(ownerId)).toEqual({ revision: 1, value });
    for (const field of ['rootId', 'platform', 'endpoint', 'adapterId', 'subjectId'] as const) {
      expect(await store.loadCatalog(personalSessionOwnerId({ ...owner, [field]: `${owner[field]}-other` }))).toBeUndefined();
    }
    expect(value.connections.c).not.toBe((await store.loadCatalog(ownerId))!.value.connections.c);
    expect(Object.isFrozen((await store.loadCatalog(ownerId))!.value.connections.c)).toBe(true);
    expect(await store.compareExchangeCatalog(ownerId, 0, value)).toEqual({ kind: 'conflict', actualRevision: 1 });
  });

  it('commits exactly one competing catalog write with no implicit retry', async () => {
    const { port } = persistence();
    const ownerId = personalSessionOwnerId(identity().owner);
    const results = await Promise.all([1, 2].map(() => new PersonalModelStateStore(() => port).compareExchangeCatalog(ownerId, 0, catalog(ownerId))));
    expect(results.map(result => result.kind).sort()).toEqual(['conflict', 'updated']);
    expect(port.compareExchange).toHaveBeenCalledTimes(2);
  });

  it('requires persistence and propagates read/write errors instead of treating them as absence', async () => {
    const own = identity();
    const missing = new PersonalModelStateStore(() => undefined);
    await expect(missing.read(own)).rejects.toBeInstanceOf(PersonalModelStateUnavailableError);
    await expect(missing.compareAndSet(0, { identity: own, revision: 1, selection: { kind: 'inherit' } })).rejects.toBeInstanceOf(PersonalModelStateUnavailableError);
    await expect(missing.loadCatalog(personalSessionOwnerId(own.owner))).rejects.toBeInstanceOf(PersonalModelStateUnavailableError);
    const { port } = persistence();
    const failure = new Error('database unavailable');
    vi.mocked(port.read).mockRejectedValueOnce(failure);
    const store = new PersonalModelStateStore(() => port);
    await expect(store.read(own)).rejects.toBe(failure);
    vi.mocked(port.compareExchange).mockRejectedValueOnce(failure);
    await expect(store.compareExchangeCatalog(personalSessionOwnerId(own.owner), 0, catalog(personalSessionOwnerId(own.owner)))).rejects.toBe(failure);
    expect(port.compareExchange).toHaveBeenCalledTimes(1);
  });

  it('resolves the active persistent port at each operation without mixing ports inside a CAS', async () => {
    const first = persistence(); const second = persistence();
    let active: PersistentStatePort | undefined = first.port;
    const store = new PersonalModelStateStore(() => active);
    const ownerId = personalSessionOwnerId(identity().owner);
    await store.compareExchangeCatalog(ownerId, 0, catalog(ownerId));
    active = second.port;
    expect(await store.loadCatalog(ownerId)).toBeUndefined();
    active = undefined;
    await expect(store.loadCatalog(ownerId)).rejects.toBeInstanceOf(PersonalModelStateUnavailableError);
    active = first.port;
    expect((await store.loadCatalog(ownerId))!.revision).toBe(1);
  });

  it('rejects cross-owner catalog connections, raw keys, corrupt state and foreign Session addresses', async () => {
    const { port, rows } = persistence();
    const own = identity(); const ownerId = personalSessionOwnerId(own.owner);
    const store = new PersonalModelStateStore(() => port);
    await expect(store.compareExchangeCatalog(ownerId, 0, catalog(personalSessionOwnerId(identity('bob').owner)))).rejects.toBeInstanceOf(PersonalModelStateIntegrityError);
    await expect(store.compareExchangeCatalog(ownerId, 0, { ...catalog(ownerId), apiKey: 'submitted-secret' } as unknown as ModelCatalogConfig)).rejects.toThrow('invalid-config');
    rows.set(own.key, { revision: 'token', expiresAt: null, value: { version: 1, kind: 'personal-session', state: JSON.parse(JSON.stringify({ identity: identity('bob'), revision: 1, selection: { kind: 'inherit' } })) as JsonValue } });
    await expect(store.read(own)).rejects.toBeInstanceOf(PersonalSessionRepositoryIntegrityError);
    await store.compareExchangeCatalog(ownerId, 0, catalog(ownerId));
    const key = [...rows.keys()].find(key => key !== own.key)!;
    const row = rows.get(key)!;
    rows.set(key, { ...row, value: { version: 1, kind: 'personal-catalog', ownerId: 'someone-else', revision: 1, catalog: {} } });
    await expect(store.loadCatalog(ownerId)).rejects.toBeInstanceOf(PersonalModelStateIntegrityError);
    expect(JSON.stringify([...rows.values()])).not.toContain('submitted-secret');
  });
});
