import { describe, expect, it, vi } from 'vitest';
import { MemoryPersonalSessionRepository, personalSessionOwnerId, type PersonalSessionOwner } from '@zhin.js/agent/personal-session';
import type { ModelCatalogConfig } from '@zhin.js/ai/model-catalog';
import { PersonalModelManagementService, type PersonalModelManagementState } from '../../../src/plugin-runtime/personal-models/service.js';
import type { PersonalModelCatalogSnapshot } from '../../../src/plugin-runtime/personal-models/state.js';

vi.mock('@zhin.js/agent/security', async () => import('../../../../../packages/im/agent/src/security/network-policy.js'));
const binding: PersonalSessionOwner = { rootId: 'root', platform: 'qq', endpoint: 'account', adapterId: 'root\0adapter\0qq', subjectId: 'person-a' };
function sessionAddress() {
  return { rootId: binding.rootId, platform: binding.platform, endpoint: binding.endpoint, subjectId: binding.subjectId,
    conversation: { endpoint: { adapter: 'feature-id', id: binding.adapterId }, kind: 'group' as const, id: 'room' } };
}
function host(): ModelCatalogConfig {
  return { connections: { host: { id: 'host', ownerId: 'host-owner', revision: 1, sdk: 'ollama', baseUrl: 'http://localhost:11434', secretRef: 'env://HOST_ONLY' } },
    models: { hm: { id: 'hm', connectionId: 'host', model: 'deployed', capabilities: {} } }, presets: { deployed: { id: 'deployed', modelId: 'hm' } } };
}
function fixture() {
  const sessions = new MemoryPersonalSessionRepository();
  const catalogs = new Map<string, PersonalModelCatalogSnapshot>();
  const state: PersonalModelManagementState = {
    read: vi.fn(identity => sessions.read(identity)),
    compareAndSet: vi.fn((revision, next) => sessions.compareAndSet(revision, next)),
    loadCatalog: vi.fn(async ownerId => catalogs.get(ownerId)),
    compareExchangeCatalog: vi.fn(async (ownerId, revision, value) => {
      const previous = catalogs.get(ownerId);
      if ((previous?.revision ?? 0) !== revision) return { kind: 'conflict' as const, actualRevision: previous?.revision ?? 0 };
      const snapshot = { revision: revision + 1, value };
      catalogs.set(ownerId, snapshot);
      return { kind: 'updated' as const, snapshot };
    }),
  };
  const rollback = vi.fn(async () => undefined);
  const put = vi.fn(async (_input: { ownerId: string; apiKey: string }) => 'opaque-synthetic-reference');
  const vault = { put, resolve: vi.fn(async () => 'synthetic-key'),
    prepare: vi.fn(async (input: { ownerId: string; apiKey: string }) => ({ secretRef: await put(input), rollback })) };
  const options = { rootId: 'root', hostOwnerId: 'host-owner', bindings: { console_person: [binding] }, state, vault, hostCatalog: host };
  return { service: new PersonalModelManagementService(options), state, vault, catalogs, options, rollback };
}
function putInput() {
  return { owner: binding, expectedRevision: 0, entry: { sdk: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'custom-model', apiKey: 'synthetic-key', capabilities: { input: ['text'], streaming: true } } };
}

describe('personal model management service', () => {
  it('stores only credential references and returns detached metadata with no secretRef or API key', async () => {
    const f = fixture();
    const written = await f.service.putModel('console_person', putInput());
    expect(written.revision).toBe(1);
    expect(written.presetId).toMatch(/^personal-preset:/);
    expect(f.vault.put).toHaveBeenCalledWith({ ownerId: personalSessionOwnerId(binding), apiKey: 'synthetic-key' });
    const stored = f.catalogs.get(personalSessionOwnerId(binding))!;
    expect(Object.values(stored.value.connections)[0].secretRef).toBe('opaque-synthetic-reference');
    expect(JSON.stringify(stored)).not.toContain('synthetic-key');
    const view = await f.service.listModels('console_person');
    expect(view.owners[0].connections[0].hasKey).toBe(true);
    expect(view.deployment).toEqual([{ id: 'deployed', modelId: 'hm', model: 'deployed', sdk: 'ollama', capabilities: {} }]);
    for (const value of [written, view]) {
      expect(JSON.stringify(value)).not.toContain('secretRef');
      expect(JSON.stringify(value)).not.toContain('synthetic-key');
      expect(JSON.stringify(value)).not.toContain('HOST_ONLY');
    }
    expect(f.vault.resolve).not.toHaveBeenCalled();
  });

  it('updates owned metadata using stable opaque ids, preserving the key unless explicitly submitted', async () => {
    const f = fixture();
    const initial = await f.service.putModel('console_person', putInput());
    const { apiKey: _apiKey, ...entry } = putInput().entry;
    const updated = await f.service.putModel('console_person', { owner: binding, expectedRevision: 1,
      entry: { ...entry, presetId: initial.presetId, model: 'other-model' } });
    expect(updated.presetId).toBe(initial.presetId);
    expect(updated.connections[0].id).toBe(initial.connections[0].id);
    expect(updated.connections[0].revision).toBe(2);
    expect(updated.models[0].model).toBe('other-model');
    expect(f.vault.put).toHaveBeenCalledTimes(1);
  });

  it('rejects stale metadata before creating a key and never retries a CAS conflict', async () => {
    const f = fixture();
    await f.service.putModel('console_person', putInput());
    await expect(f.service.putModel('console_person', putInput())).rejects.toMatchObject({ code: 'conflict' });
    expect(f.vault.put).toHaveBeenCalledTimes(1);
    vi.mocked(f.state.compareExchangeCatalog).mockResolvedValueOnce({ kind: 'conflict', actualRevision: 2 });
    await expect(f.service.putModel('console_person', { ...putInput(), expectedRevision: 1 })).rejects.toMatchObject({ code: 'conflict' });
    expect(f.state.compareExchangeCatalog).toHaveBeenCalledTimes(2);
  });

  it('uses only authenticated bindings, with no ownerId or principalId body authority', async () => {
    const f = fixture();
    await expect(f.service.listModels('')).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(f.service.listModels('operator_without_binding')).rejects.toMatchObject({ code: 'forbidden' });
    for (const owner of [{ ...binding, subjectId: 'person-b' }, { ...binding, endpoint: 'other-account' }, { ...binding, rootId: 'other-root' }]) {
      await expect(f.service.putModel('console_person', { ...putInput(), owner })).rejects.toMatchObject({ code: 'forbidden' });
    }
    for (const extra of [{ ownerId: 'forged' }, { principalId: 'forged' }, { permissions: ['*'] }, { tools: [] }]) {
      await expect(f.service.putModel('console_person', { ...putInput(), ...extra })).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(f.vault.put).not.toHaveBeenCalled();
    expect(f.state.loadCatalog).not.toHaveBeenCalled();
    expect(() => new PersonalModelManagementService({ ...f.options, bindings: { p: [{ ...binding, rootId: 'other-host' }] } })).toThrow();
  });

  it('never treats inherited object properties as an existing owned preset', async () => {
    const f = fixture();
    for (const presetId of ['__proto__', 'toString', 'constructor']) {
      await expect(f.service.putModel('console_person', { ...putInput(), entry: { ...putInput().entry, presetId } })).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(f.vault.put).not.toHaveBeenCalled();
  });

  it('validates protocol, capability and URL contracts before touching credentials', async () => {
    const f = fixture();
    for (const entry of [
      { ...putInput().entry, sdk: 'invented-protocol' },
      { ...putInput().entry, capabilities: { toolAdmission: true } },
      { ...putInput().entry, capabilities: null },
      { ...putInput().entry, baseUrl: 'http://provider.example' },
      { ...putInput().entry, baseUrl: 'https://localhost' },
      { ...putInput().entry, baseUrl: 'https://user:synthetic-key@provider.example' },
      { ...putInput().entry, apiKey: '' },
      { ...putInput().entry, secretRef: 'forged' },
    ]) await expect(f.service.putModel('console_person', { ...putInput(), entry })).rejects.toThrow();
    expect(f.vault.put).not.toHaveBeenCalled();
  });

  it.each(['api_key', 'key', 'apiKey', 'access_token', 'token', 'authorization', 'password', 'client_secret'])(
    'rejects credential query %s before any vault or catalog write and never returns it as metadata', async parameter => {
      const f = fixture();
      const input = putInput();
      const secret = 'synthetic-query-secret';
      await expect(f.service.putModel('console_person', {
        ...input, entry: { ...input.entry, baseUrl: `${input.entry.baseUrl}?region=ap&${parameter}=${secret}` },
      })).rejects.toMatchObject({ code: 'invalid_input' });
      expect(f.vault.prepare).not.toHaveBeenCalled();
      expect(f.vault.put).not.toHaveBeenCalled();
      expect(f.state.compareExchangeCatalog).not.toHaveBeenCalled();
      expect(f.catalogs.size).toBe(0);
      const view = await f.service.listModels('console_person');
      expect(view.owners[0]!.connections).toEqual([]);
      expect(JSON.stringify(view)).not.toContain(secret);
      expect(JSON.stringify([...f.catalogs.values()])).not.toContain(secret);
    },
  );

  it('preserves ordinary region and api-version query metadata while keeping the API key separate', async () => {
    const f = fixture();
    const input = putInput();
    const baseUrl = `${input.entry.baseUrl}?region=ap&api-version=2026-10`;
    const result = await f.service.putModel('console_person', { ...input, entry: { ...input.entry, baseUrl } });
    expect(result.connections[0]!.baseUrl).toBe(baseUrl);
    expect(f.catalogs.size).toBe(1);
    expect(JSON.stringify(result)).not.toContain(input.entry.apiKey);
    expect(JSON.stringify([...f.catalogs.values()])).not.toContain(input.entry.apiKey);
  });

  it('switches an exact owned Session to personal, deployed or inherited references with CAS', async () => {
    const f = fixture();
    const model = await f.service.putModel('console_person', putInput());
    const address = sessionAddress();
    const initial = await f.service.readSession('console_person', address);
    expect(initial.state.selection).toEqual({ kind: 'inherit' });
    expect(initial.presets.deployment[0].id).toBe('deployed');
    expect(initial.presets.personal[0].id).toBe(model.presetId);
    const personal = await f.service.selectSession('console_person', { address, expectedRevision: 0, selection: { kind: 'preset', presetId: model.presetId } });
    expect(personal.selection).toEqual({ kind: 'preset', presetId: model.presetId });
    await expect(f.service.selectSession('console_person', { address, expectedRevision: 0, selection: { kind: 'inherit' } })).rejects.toMatchObject({ code: 'conflict' });
    const deployed = await f.service.selectSession('console_person', { address, expectedRevision: 1, selection: { kind: 'preset', presetId: 'deployed' } });
    expect(deployed.revision).toBe(2);
    const inherited = await f.service.selectSession('console_person', { address, expectedRevision: 2, selection: { kind: 'inherit' } });
    expect(inherited.selection).toEqual({ kind: 'inherit' });
    expect(f.vault.resolve).not.toHaveBeenCalled();
  });

  it('rejects forged Session ownership and unknown explicit presets before writing', async () => {
    const f = fixture();
    const address = sessionAddress();
    for (const forged of [{ ...address, subjectId: 'person-b' }, { ...address, endpoint: 'other-account' }, { ...address, rootId: 'other-host' }]) {
      await expect(f.service.readSession('console_person', forged)).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(f.service.selectSession('console_person', { address, expectedRevision: 0, selection: { kind: 'preset', presetId: 'missing' } })).rejects.toMatchObject({ code: 'unknown-preset' });
    await expect(f.service.selectSession('console_person', { address, expectedRevision: 0, selection: { kind: 'inherit' }, tools: ['dangerous'] })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(f.state.compareAndSet).not.toHaveBeenCalled();
  });

  it('surfaces missing/unreadable persistence as unavailable instead of empty state or fallback', async () => {
    const f = fixture();
    vi.mocked(f.state.loadCatalog).mockRejectedValue(new Error('synthetic-key must not escape'));
    const error = await f.service.listModels('console_person').catch(value => value);
    expect(error.code).toBe('unavailable'); expect(String(error)).not.toContain('synthetic-key');
    vi.mocked(f.state.read).mockRejectedValue(new Error('missing database'));
    await expect(f.service.readSession('console_person', sessionAddress())).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.vault.put).not.toHaveBeenCalled();
  });
  it('rolls back a fresh credential only after a definitive CAS conflict', async () => {
    const f = fixture();
    vi.mocked(f.state.compareExchangeCatalog).mockResolvedValueOnce({ kind: 'conflict', actualRevision: 1 });
    await expect(f.service.putModel('console_person', putInput())).rejects.toMatchObject({ code: 'conflict' });
    expect(f.rollback).toHaveBeenCalledOnce();
    expect(f.state.compareExchangeCatalog).toHaveBeenCalledOnce();
  });

  it('retains the credential when a metadata commit outcome is unknown', async () => {
    const f = fixture();
    vi.mocked(f.state.compareExchangeCatalog).mockRejectedValueOnce(new Error('connection lost after commit'));
    await expect(f.service.putModel('console_person', putInput())).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.rollback).not.toHaveBeenCalled();
    expect(f.state.compareExchangeCatalog).toHaveBeenCalledOnce();
  });

  it('preserves the confirmed conflict when fresh-credential cleanup fails', async () => {
    const f = fixture();
    vi.mocked(f.state.compareExchangeCatalog).mockResolvedValueOnce({ kind: 'conflict', actualRevision: 1 });
    f.rollback.mockRejectedValueOnce(new Error('synthetic private storage error'));
    await expect(f.service.putModel('console_person', putInput())).rejects.toMatchObject({ code: 'conflict' });
    expect(f.rollback).toHaveBeenCalledOnce();
    expect(f.state.compareExchangeCatalog).toHaveBeenCalledOnce();
  });

  it('supports the existing unauthenticated Ollama contract without a credential record', async () => {
    const f = fixture();
    const { apiKey: _key, ...entry } = putInput().entry;
    const saved = await f.service.putModel('console_person', { ...putInput(), entry: { ...entry, sdk: 'ollama' } });
    expect(saved.connections[0].hasKey).toBe(false);
    expect(f.vault.prepare).not.toHaveBeenCalled();
    expect(Object.values(f.catalogs.get(personalSessionOwnerId(binding))!.value.connections)[0].secretRef).toBeUndefined();
  });

  it('requires target-SDK credentials when changing an unauthenticated Ollama connection', async () => {
    const f = fixture();
    const { apiKey: _key, ...entry } = putInput().entry;
    const initial = await f.service.putModel('console_person', { ...putInput(), entry: { ...entry, sdk: 'ollama' } });
    const update = { owner: binding, expectedRevision: 1, entry: { ...entry, presetId: initial.presetId, sdk: 'openai' } };
    await expect(f.service.putModel('console_person', update)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(f.vault.prepare).not.toHaveBeenCalled();
    expect(f.catalogs.get(personalSessionOwnerId(binding))?.revision).toBe(1);
    const changed = await f.service.putModel('console_person', { ...update, entry: { ...update.entry, apiKey: 'synthetic-new-key' } });
    expect(changed.connections[0].sdk).toBe('openai');
    expect(changed.connections[0].hasKey).toBe(true);
    expect(changed.revision).toBe(2);
    expect(f.vault.prepare).toHaveBeenCalledOnce();
  });

});
