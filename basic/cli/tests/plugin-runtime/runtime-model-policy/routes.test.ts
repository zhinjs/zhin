import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { HttpHost, HttpHandler } from '@zhin.js/host-http';
import type { PersistentStatePort, StateRecord } from '@zhin.js/plugin-runtime';
import { TokenRegistry } from '../../../../../packages/host/http/src/token-registry.js';
import { ModelRuntimeService } from '@zhin.js/agent/model-runtime';
import { registerRuntimeModelPolicyRoutes } from '../../../src/plugin-runtime/runtime-model-policy/routes.js';
import { RuntimePolicyManagementService } from '../../../src/plugin-runtime/runtime-model-policy/service.js';
import { PersistentRuntimePolicyRepository } from '../../../src/plugin-runtime/runtime-model-policy/state.js';
vi.mock('@zhin.js/host-http', async () => import('../../../../../packages/host/http-contract/src/index.js'));

it('uses authenticated local HTTP with body parsing, CAS, safe errors and unchanged runtime objects', async () => {
  const rootId = '/http-policy-fixture', hostOwnerId = 'host-owner';
  let row: StateRecord | undefined, unknownCommit = false, failingRead = false;
  const write = vi.fn<PersistentStatePort['compareExchange']>(async (_owner, _scope, _key, revision, value, expiresAt) => {
    if (row?.revision !== revision) return false;
    row = { revision: 'database-' + String(Number((row?.value as { revision?: number })?.revision ?? 0) + 1), value: value!, expiresAt };
    if (unknownCommit) throw new Error('synthetic-private-key');
    return true;
  });
  let state: PersistentStatePort | undefined = { read: async () => { if (failingRead) throw new Error('private database detail'); return row; }, compareExchange: write };
  const connectedState = state;
  const repository = new PersistentRuntimePolicyRepository({ rootId, hostOwnerId, state: () => state });
  const runtime = new ModelRuntimeService({ hostOwnerId, rootId, runtimePolicySnapshot: () => repository.read(), config: {
    modelCatalog: { connections: { local: { revision: 1, sdk: 'ollama', baseUrl: 'https://fake.test', secretRef: 'private-reference' } },
      models: { a: { connectionId: 'local', model: 'a', capabilities: {} }, b: { connectionId: 'local', model: 'b', capabilities: {} } },
      presets: { a: { modelId: 'a' }, b: { modelId: 'b' } } }, modelPolicy: { defaults: { chat: 'a' } },
  } });
  const service = new RuntimePolicyManagementService({ rootId, repository, runtime: () => runtime });
  const registry = new TokenRegistry({ primaryToken: 'synthetic-full', scopedTokens: [{ token: 'synthetic-user', scope: 'demo', principalId: 'alice' }] });
  const handlers = new Map<string, HttpHandler>(), release = vi.fn(), acquire = vi.fn(() => ({ service, release }));
  registerRuntimeModelPolicyRoutes({ base: '/api', acquireService: acquire,
    http: { tokenRegistry: registry, route: (method: string, path: string, handler: HttpHandler) => { handlers.set(`${method} ${path}`, handler); return () => {}; } } as unknown as HttpHost });
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    const handler = handlers.get(`${request.method} ${url.pathname}`);
    if (!handler) { response.writeHead(404); response.end(); return; }
    const token = request.headers.authorization?.replace(/^Bearer /u, '') ?? '';
    Promise.resolve(handler(request, response, url, registry.resolve(token) ?? 'demo')).catch(() => { response.writeHead(500); response.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method = 'GET', body?: unknown, token = 'synthetic-full', query = '') => fetch(`${origin}/api/agent/model-policy${query}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const pid = process.pid;
  try {
    const rejected = await call('PUT', { apiKey: 'synthetic-private-key' }, 'synthetic-user');
    expect(rejected.status).toBe(403); expect(acquire).not.toHaveBeenCalled();
    const initial = await call(); expect(initial.status).toBe(200); expect(initial.headers.get('cache-control')).toBe('no-store');
    const first = await initial.json(); expect(first.data).toMatchObject({ revision: 0, refsOverride: { defaults: {} }, baseline: { defaults: { chat: 'a' } } });
    expect(JSON.stringify(first)).not.toMatch(/secretRef|private-reference|synthetic-private-key|hostFactoryData/);
    expect((await call('GET', undefined, 'synthetic-full', '?ownerId=forged')).status).toBe(400);
    expect((await call('GET', undefined, 'synthetic-full', '?targetsLimit=501&targetsOffset=0')).status).toBe(400);
    expect((await call('PUT', { expectedRevision: 0, refsOverride: { defaults: { chat: 'missing' } } })).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
    const saved = await call('PUT', { expectedRevision: 0, refsOverride: { defaults: { chat: 'b' } } });
    expect(saved.status).toBe(200); expect((await saved.json()).data.revision).toBe(1);
    expect((await runtime.resolveForTurn({ rootId, ownerId: hostOwnerId })).chat.model.model).toBe('b');
    expect((await call('PUT', { expectedRevision: 0, refsOverride: {} })).status).toBe(409); expect(write).toHaveBeenCalledOnce();
    unknownCommit = true;
    const unknown = await call('PUT', { expectedRevision: 1, refsOverride: {} });
    expect(unknown.status).toBe(503); expect(await unknown.json()).toMatchObject({ success: false, code: 'commit_unknown' });
    expect((await (await call()).json()).data).toMatchObject({ revision: 2, refsOverride: { defaults: {} } });
    expect(write).toHaveBeenCalledTimes(2);
    failingRead = true; expect((await call()).status).toBe(503); expect(write).toHaveBeenCalledTimes(2);
    failingRead = false; state = undefined; expect((await call()).status).toBe(503);
    state = connectedState; unknownCommit = false;
    // Simulate a valid persisted reference from an earlier deployment whose preset was removed.
    await repository.compareExchange(2, { defaults: { chat: 'removed-preset' } });
    const dangling = await call(); expect(dangling.status).toBe(200);
    expect((await dangling.json()).data).toMatchObject({ revision: 3, refsOverride: { defaults: { chat: 'removed-preset' } } });
    await expect(runtime.resolveForTurn({ rootId, ownerId: hostOwnerId })).rejects.toMatchObject({ code: 'unknown-preset' });
    const beforeInvalid = write.mock.calls.length;
    expect((await call('PUT', { expectedRevision: 3, refsOverride: { defaults: { chat: 'still-missing' } } })).status).toBe(400);
    expect(write).toHaveBeenCalledTimes(beforeInvalid);
    const recovered = await call('PUT', { expectedRevision: 3, refsOverride: {} }); expect(recovered.status).toBe(200);
    expect((await runtime.resolveForTurn({ rootId, ownerId: hostOwnerId })).chat.model.model).toBe('a');
    await repository.compareExchange(4, { endpoints: [{ address: { rootId: '/foreign-root', platform: 'icqq', endpoint: 'account', adapterId: 'canonical' }, models: { chat: 'a' } }] });
    expect((await call()).status).toBe(503);
    expect(process.pid).toBe(pid); expect(acquire.mock.results.every(result => result.value.service === service)).toBe(true);
    expect(release).toHaveBeenCalledTimes(acquire.mock.calls.length);
  } finally { server.close(); await once(server, 'close'); await runtime.dispose(); }
});
