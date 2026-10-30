import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthScope, HttpHandler, HttpHost } from '@zhin.js/host-http';
import { MemoryPersonalSessionRepository, personalSessionIdentity } from '@zhin.js/agent/personal-session';
import { registerPersonalModelRoutes, type PersonalModelManagementLease } from '../../../src/plugin-runtime/personal-models/routes.js';
import { PersonalModelManagementService, type PersonalModelManagementState } from '../../../src/plugin-runtime/personal-models/service.js';
import type { PersonalModelCatalogSnapshot } from '../../../src/plugin-runtime/personal-models/state.js';

// Execute the real shared body parser and domain modules while skipping unrelated unbuilt barrels.
vi.mock('@zhin.js/host-http', async () => import('../../../../../packages/host/http-contract/src/index.js'));
vi.mock('@zhin.js/agent/security', async () => import('../../../../../packages/im/agent/src/security/network-policy.js'));

const address = { rootId: 'root', platform: 'qq', endpoint: 'account', subjectId: 'person',
  conversation: { endpoint: { adapter: 'feature', id: 'root\0adapter\0qq' }, kind: 'private' as const, id: 'person' } };
const owner = personalSessionIdentity(address).owner;
function fixture() {
  const repository = new MemoryPersonalSessionRepository();
  const catalogs = new Map<string, PersonalModelCatalogSnapshot>();
  const state: PersonalModelManagementState = {
    read: identity => repository.read(identity), compareAndSet: (revision, next) => repository.compareAndSet(revision, next),
    loadCatalog: async ownerId => catalogs.get(ownerId),
    compareExchangeCatalog: async (ownerId, revision, value) => {
      const actual = catalogs.get(ownerId)?.revision ?? 0;
      if (actual !== revision) return { kind: 'conflict', actualRevision: actual };
      const snapshot = { revision: revision + 1, value }; catalogs.set(ownerId, snapshot);
      return { kind: 'updated', snapshot };
    },
  };
  const service = new PersonalModelManagementService({ rootId: 'root', hostOwnerId: 'host', bindings: { person_token: [owner] },
    state, vault: { prepare: async () => ({ secretRef: 'opaque-key-reference', rollback: async () => undefined }), put: async () => 'opaque-key-reference', resolve: async () => 'synthetic-key' },
    directory: async () => ({ rows: [{ sessionKey: personalSessionIdentity(address).key, address, updatedAt: 123 }], hasMore: false }),
    hostCatalog: () => ({ connections: {}, models: {}, presets: {} }) });
  const handlers = new Map<string, HttpHandler>();
  const http = { route: (method: string, path: string, handler: HttpHandler) => { handlers.set(`${method} ${path}`, handler); return () => {}; } } as unknown as HttpHost;
  const release = vi.fn();
  const acquireService = vi.fn<() => PersonalModelManagementLease | undefined>(() => ({ service, release }));
  registerPersonalModelRoutes({ http, base: '/api', acquireService });
  async function call(method: string, path: string, body?: unknown, principalId: string | null = 'person_token', scope: AuthScope = 'demo', raw?: string) {
    let payload = ''; let status = 0; let bodyReads = 0;
    const request = Readable.from((async function* () { bodyReads += 1; if (raw !== undefined) yield Buffer.from(raw); else if (body !== undefined) yield Buffer.from(JSON.stringify(body)); })()) as unknown as IncomingMessage;
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => { headers[name] = value; },
      writeHead: (value: number) => { status = value; }, end: (value: string) => { payload = value; },
    } as unknown as ServerResponse;
    const url = new URL(path, 'https://host.example');
    await handlers.get(`${method} ${url.pathname}`)!(request, response, url, scope,
      principalId === null ? undefined : { principalId, scope });
    return { status, json: JSON.parse(payload), payload, headers, bodyReads };
  }
  return { call, service, acquireService, release, handlers };
}

describe('personal model management HTTP boundary', () => {
  it('registers personal management and the owner-filtered current Session directory', () => {
    const f = fixture();
    expect([...f.handlers.keys()]).toEqual(['GET /api/agent/personal-models', 'PUT /api/agent/personal-models', 'GET /api/agent/personal-sessions', 'GET /api/agent/personal-session', 'PUT /api/agent/personal-session']);
  });

  it('requires authenticated personal binding for both user and operator tokens, before reading keys', async () => {
    const f = fixture();
    const anonymous = await f.call('PUT', '/api/agent/personal-models', { apiKey: 'synthetic-key' }, null, 'full');
    expect(anonymous.status).toBe(401); expect(anonymous.bodyReads).toBe(0);
    expect(f.acquireService).not.toHaveBeenCalled();
    const operator = await f.call('GET', '/api/agent/personal-models', undefined, 'operator', 'full');
    expect(operator.status).toBe(403);
    const personal = await f.call('GET', '/api/agent/personal-models');
    expect(personal.status).toBe(200); expect(personal.headers['cache-control']).toBe('no-store');
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it('reads a real PUT body, returns redacted metadata, then returns stale CAS as 409', async () => {
    const f = fixture();
    const input = { owner, expectedRevision: 0, entry: { sdk: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'custom', apiKey: 'synthetic-key' } };
    const created = await f.call('PUT', '/api/agent/personal-models', input);
    expect(created.status).toBe(200); expect(created.json.data.revision).toBe(1);
    expect(created.payload).not.toContain('synthetic-key'); expect(created.payload).not.toContain('secretRef');
    const stale = await f.call('PUT', '/api/agent/personal-models', input);
    expect(stale.status).toBe(409); expect(stale.json.code).toBe('conflict');
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it('holds and releases one lease for invalid JSON, forbidden query fields and service errors', async () => {
    const f = fixture();
    const malformed = await f.call('PUT', '/api/agent/personal-models', undefined, 'person_token', 'demo', '{"apiKey":"synthetic-key"');
    expect(malformed.status).toBe(400); expect(malformed.payload).not.toContain('synthetic-key');
    const forged = await f.call('GET', '/api/agent/personal-models?principalId=operator');
    expect(forged.status).toBe(400);
    vi.spyOn(f.service, 'listModels').mockRejectedValueOnce(new Error('synthetic-key'));
    const failure = await f.call('GET', '/api/agent/personal-models');
    expect(failure.status).toBe(503); expect(failure.payload).not.toContain('synthetic-key');
    expect(f.release).toHaveBeenCalledTimes(3);
  });

  it('accepts only a complete owned Session address and returns unknown presets without fallback', async () => {
    const f = fixture();
    const query = encodeURIComponent(JSON.stringify(address));
    const read = await f.call('GET', `/api/agent/personal-session?address=${query}`);
    expect(read.status).toBe(200); expect(read.json.data.state.revision).toBe(0);
    const forged = await f.call('GET', `/api/agent/personal-session?address=${encodeURIComponent(JSON.stringify({ ...address, subjectId: 'other' }))}`);
    expect(forged.status).toBe(403);
    const selected = await f.call('PUT', '/api/agent/personal-session', { address, expectedRevision: 0, selection: { kind: 'preset', presetId: 'missing' } });
    expect(selected.status).toBe(404); expect(selected.json.code).toBe('unknown-preset');
    expect(f.release).toHaveBeenCalledTimes(3);
  });

  it('returns unavailable with no generation and creates no lease or state fallback', async () => {
    const f = fixture();
    vi.mocked(f.acquireService).mockReturnValueOnce(undefined);
    const result = await f.call('GET', '/api/agent/personal-models');
    expect(result.status).toBe(503); expect(f.release).not.toHaveBeenCalled();
  });
  it('authenticates and scopes the current Session directory before reading metadata', async () => {
    const f = fixture();
    const query = new URLSearchParams({ owner: JSON.stringify(owner), limit: '50', offset: '0' });
    const own = await f.call('GET', `/api/agent/personal-sessions?${query}`);
    expect(own.status).toBe(200);
    expect(own.json.data.rows).toEqual([{ sessionKey: personalSessionIdentity(address).key, address, updatedAt: 123 }]);
    query.set('owner', JSON.stringify({ ...owner, subjectId: 'someone-else' }));
    expect((await f.call('GET', `/api/agent/personal-sessions?${query}`)).status).toBe(403);
    query.set('owner', JSON.stringify(owner)); query.set('limit', '501');
    expect((await f.call('GET', `/api/agent/personal-sessions?${query}`)).status).toBe(400);
    expect((await f.call('GET', '/api/agent/personal-sessions')).status).toBe(400);
    expect(f.release).toHaveBeenCalledTimes(4);
  });

});
