import { withDeploymentModelScope } from '../../../src/plugin-runtime/personal-models/deployment-scope.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '@zhin.js/agent';
import { personalSessionIdentity, personalSessionOwnerId } from '@zhin.js/agent/personal-session';
import type { TurnRequest } from '@zhin.js/agent/turn';
import type { PersistentStatePort, StateRecord, JsonValue } from '@zhin.js/plugin-runtime';
import { createPersonalModelHost } from '../../../src/plugin-runtime/personal-models/host.js';
import { PersonalModelManagementService } from '../../../src/plugin-runtime/personal-models/service.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function database() {
  const rows = new Map<string, StateRecord>(); let sequence = 0;
  const port: PersistentStatePort = {
    read: vi.fn(async (_owner, _scope, key) => rows.get(key)),
    compareExchange: async (_owner, _scope, key, revision, value, expiresAt) => {
      if (rows.get(key)?.revision !== revision) return false;
      if (value === undefined) rows.delete(key);
      else rows.set(key, { revision: String(++sequence), value: structuredClone(value) as JsonValue, expiresAt });
      return true;
    },
  };
  return port;
}
async function fixture(state?: PersistentStatePort) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-model-host-')); roots.push(projectRoot);
  const host = createPersonalModelHost({ projectRoot, state: () => state, resolveHostSecret: () => undefined });
  const service = new AIService({ providers: { local: { sdk: 'ollama', baseUrl: 'http://localhost:11434', models: ['deployment'] } },
    agents: { zhin: { provider: 'local', model: 'deployment' } } });
  await service.prepareModelRuntime(host.runtimeOptions);
  const identity = personalSessionIdentity({ rootId: projectRoot, platform: 'qq', endpoint: 'account', subjectId: 'person',
    conversation: { endpoint: { adapter: 'root', id: 'root\0adapter\0qq' }, kind: 'group', id: 'room' } });
  const request: TurnRequest = {
    identity: { turnId: 'turn', traceId: 'trace' },
    origin: { kind: 'im', platform: 'qq', endpoint: 'account', scope: 'group', sceneId: 'room', conversation: identity.address.conversation },
    principal: { subjectId: 'person', roles: ['member'] }, input: { text: 'hello' }, intent: { kind: 'new' },
    session: { key: identity.key, personal: identity.address }, policy: { permissions: [], unattended: false },
    signal: new AbortController().signal, ports: {},
  };
  return { host, service, identity, request, port: host.turnPort(service), binding: service.getBindingRegistry().requireZhinBinding() };
}

describe('personal model Host composition', () => {
  it('keeps system tasks on deployment models without reading personal persistence', async () => {
    const state = database();
    const f = await fixture(state);
    vi.mocked(state.read).mockImplementation(async (_owner, _scope, key) => {
      if (key.startsWith('runtime-model-policy:v1:')) return undefined;
      throw new Error('personal storage unavailable');
    });
    try {
      const scope = await f.port.acquire({ ...f.request, session: { key: 'scene-task:v1:system' } }, f.binding);
      expect(scope.chat.invocation.model.model).toBe('deployment');
      expect(scope.chat.invocation.connection.ownerId).toBe(f.host.hostOwnerId);
      expect(state.read).toHaveBeenCalledOnce();
      expect(vi.mocked(state.read).mock.calls[0]![2]).toMatch(/^runtime-model-policy:v1:/u);
      await scope.release();
    } finally { await f.service.dispose(); }
  });

  it('supports deployment-only Hosts without pretending personal persistence is available', async () => {
    const f = await fixture();
    try {
      const scope = await f.port.acquire(f.request, f.binding);
      expect(scope.chat.invocation.model.model).toBe('deployment'); await scope.release();
      await expect(f.host.sessions.read({ address: f.identity.address, owner: f.identity.owner }))
        .rejects.toMatchObject({ code: 'personal_model_state_unavailable' });
    } finally { await f.service.dispose(); }
  });

  it('propagates configured persistence failures and rejects mismatched trusted owners', async () => {
    const state = database(); const f = await fixture(state);
    try {
      vi.mocked(state.read).mockRejectedValue(new Error('database lookup failed'));
      await expect(f.port.acquire(f.request, f.binding)).rejects.toThrow('database lookup failed');
      await expect(f.port.acquire({ ...f.request, principal: { subjectId: 'another-person', roles: [] } }, f.binding))
        .rejects.toThrow('does not match trusted turn identity');
    } finally { await f.service.dispose(); }
  });

  it('switches only the next personal chat invocation and keeps in-flight snapshots and summary authority', async () => {
    const f = await fixture(database());
    const management = new PersonalModelManagementService({ rootId: f.host.rootId, hostOwnerId: f.host.hostOwnerId,
      bindings: { console_person: [f.identity.owner] }, state: f.host.state, vault: f.host.vault,
      hostCatalog: () => f.service.getModelRuntime().getCatalogConfig() });
    try {
      const before = await f.port.acquire(f.request, f.binding);
      const written = await management.putModel('console_person', { owner: f.identity.owner, expectedRevision: 0,
        entry: { sdk: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'personal-model', apiKey: 'synthetic-personal-key' } });
      await management.selectSession('console_person', { address: f.identity.address, expectedRevision: 0,
        selection: { kind: 'preset', presetId: written.presetId } });
      const after = await f.port.acquire(f.request, f.binding);
      expect(before.chat.invocation.model.model).toBe('deployment');
      expect(after.chat.invocation.model.model).toBe('personal-model');
      expect(after.chat.invocation.connection.ownerId).toBe(personalSessionOwnerId(f.identity.owner));
      expect(after.summary?.invocation.connection.ownerId).toBe(f.host.hostOwnerId);
      expect(JSON.stringify(await management.listModels('console_person'))).not.toContain('synthetic-personal-key');
      expect(f.request.session.key).toBe(f.identity.key);
      await before.release(); await after.release();
    } finally { await f.service.dispose(); }
  });
  it('keeps a committed management result and its primary error when cleanup fails', async () => {
    const f = await fixture();
    const runtime = f.service.getModelRuntime();
    const acquire = runtime.acquireForTurn.bind(runtime);
    vi.spyOn(runtime, 'acquireForTurn').mockImplementation(async (...args) => {
      const scope = await acquire(...args);
      return { ...scope, release: async () => { await scope.release(); throw new Error('synthetic release failure'); } };
    });
    try {
      await expect(withDeploymentModelScope(f.service, f.host.rootId, async () => ({ committed: true }))).resolves.toEqual({ committed: true });
      await expect(withDeploymentModelScope(f.service, f.host.rootId, async () => { throw new Error('primary management failure'); }))
        .rejects.toThrow('primary management failure');
    } finally { await f.service.dispose(); }
  });

});
