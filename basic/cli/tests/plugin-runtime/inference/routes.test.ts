import { createHttpHost } from '@zhin.js/host-http';
import { withTestUsers } from '../../utils/console-users.js';
import { MemoryPersonalSessionRepository, PersonalSessionService } from '@zhin.js/agent/personal-session';
import { registerInferenceRoutes } from '../../../src/plugin-runtime/inference/routes.js';
import { resolveInferenceManagementPrincipal } from '@zhin.js/agent/runtime';
import { InferenceSessionManagement } from '@zhin.js/agent/runtime';
import { join } from 'node:path';
import { InferenceCredentialStore, credentialMaterialFingerprint } from '@zhin.js/agent/runtime';
import { resolveHostCredentialSource } from '@zhin.js/plugin-runtime';
import { setupInferenceManagement } from './fixtures.js';

async function setup(method: 'api-key' | 'oauth' = 'oauth') {
  const fixture = await setupInferenceManagement({ method });
  // The removed `scope: user` member token is now a signed-in user without agent permissions.
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { 'operator-fixture': 'owner', 'member-fixture': 'none' });
  const release = vi.fn();
  const sessions = new InferenceSessionManagement({ rootId: '/root', hostOwnerId: 'host', owners: [],
    sessions: new PersonalSessionService(new MemoryPersonalSessionRepository()), repository: fixture.repository,
    directory: async () => ({ rows: [], hasMore: false }) });
  registerInferenceRoutes({ http, base: '/api', acquire: () => ({ management: fixture.management, accounts: fixture.accounts, sessions,
    authenticationContract: async () => '1', release }),
    owners: input => input.scope === 'full' ? [{ id: 'host', label: '部署模型', kind: 'host' }] : [{ id: 'personal-member', label: '本人', kind: 'personal' }],
    principal: input => resolveInferenceManagementPrincipal({ ...input, hostOwnerId: 'host', bindings: { member: ['personal-member'] } }) });
  const { origin } = await http.listen();
  async function call(path: string, body?: unknown, token = 'operator-fixture') {
    const response = await fetch(`${origin}/api/agent/inference${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, payload: await response.json() };
  }
  return { ...fixture, call, release, async close() { await http.close(); await fixture.close(); } };
}

it('runs manual OAuth through authenticated HTTP, keeps private verifier/token out of responses and exchanges once', async () => {
  const fixture = await setup();
  try {
    const begun = await fixture.call('/login/begin', { accountId: 'account', redirectUri: 'https://unregistered-console.test/callback' });
    expect(begun.status).toBe(200);
    const login = begun.payload.data;
    expect(login.redirectUri).toBe('http://localhost:1455/auth/callback');
    expect(JSON.stringify(begun.payload)).not.toContain('private-verifier');
    for (const body of [
      { accountId: 'account', loginId: login.loginId, callbackUrl: 'https://unregistered-console.test/callback?code=c&state=fixture-state' },
      { accountId: 'another', loginId: login.loginId, callbackUrl: `${login.redirectUri}?code=c&state=fixture-state` },
    ]) expect((await fixture.call('/login/complete', body)).status).toBe(403);
    expect(fixture.exchange).not.toHaveBeenCalled();
    const completed = await fixture.call('/login/complete', { accountId: 'account', loginId: login.loginId,
      callbackUrl: `${login.redirectUri}?code=private-fixture-code&state=fixture-state` });
    expect(completed.status).toBe(200); expect(completed.payload.data.status).toBe('ready');
    expect(fixture.exchange).toHaveBeenCalledOnce();
    expect(JSON.stringify(completed.payload)).not.toContain('private-synthetic-token');
    expect((await fixture.call('/login/complete', { accountId: 'account', loginId: login.loginId,
      callbackUrl: `${login.redirectUri}?code=private-fixture-code&state=fixture-state` })).status).toBe(403);
    expect(fixture.exchange).toHaveBeenCalledOnce();
    expect(completed.headers.get('cache-control')).toBe('no-store');
  } finally { await fixture.close(); }
});

it('retains input/conflict authorization semantics and does not allow a personal OAuth import or exchange', async () => {
  const fixture = await setup();
  try {
    expect((await fixture.call('/plan', { plan: { version: 123 } })).status).toBe(400);
    expect((await fixture.call('/plan', { plan: { version: 1, accounts: { personal: { service: 'shared', auth: { method: 'oauth' } } } },
      bindings: { services: { shared: 'service' } } }, 'member-fixture')).status).toBe(403);
    expect((await fixture.call('/login/begin', { accountId: 'account' }, 'member-fixture')).status).toBe(403);
    expect((await fixture.call('/login/complete', { accountId: 'account', loginId: 'made-up', callbackUrl: 'http://localhost:1455/auth/callback?code=x&state=y' }, 'member-fixture')).status).toBe(403);
    expect(fixture.exchange).not.toHaveBeenCalled();
    expect((await fixture.call('?owner=another-person', undefined, 'member-fixture')).status).toBe(403);
    expect((await fixture.call('', undefined, 'not-an-authenticated-token')).status).toBe(401);
  } finally { await fixture.close(); }
});

it('reports damaged persisted graphs as storage integrity failures through authenticated HTTP', async () => {
  const fixture = await setup();
  try {
    const model = fixture.db.models.get('agent_inference_graphs')!;
    for (const value of [{ invalid: true }, { ...fixture.graph, revision: 2 }]) {
      await model.update({ value }).where({ revision: 1 });
      await expect(fixture.repository.readGraph({ rootId: '/root' })).rejects.toMatchObject({ code: 'integrity' });
      const response = await fixture.call('');
      expect(response.status).toBe(503);
      expect(response.payload).toMatchObject({ success: false, code: 'storage-integrity' });
      expect(JSON.stringify(response.payload)).not.toContain('invalid-graph');
    }
  } finally { await fixture.close(); }
});

it('checks the trusted owner on every personal management route before performing Host operations', async () => {
  const fixture = await setup();
  try {
    for (const path of ['', '/export', '/mutation?mutationId=initial', '/sessions?limit=50&offset=0', '/session?address=%7B%7D', '/targets']) {
      const suffix = path.includes('?') ? '&' : '?';
      expect((await fixture.call(`${path}${suffix}owner=host`, undefined, 'member-fixture')).status).toBe(403);
    }
    for (const path of ['/plan', '/apply', '/key/prepare', '/client/prepare', '/discover', '/login/begin', '/login/complete', '/login/cancel', '/login/prepare', '/disconnect']) {
      expect((await fixture.call(`${path}?owner=host`, { accountId:'account',ownerId:'host',hostAdministrator:true }, 'member-fixture')).status).toBe(403);
    }
    expect((await fixture.call('/mutation?mutationId=initial', undefined, 'member-fixture')).status).toBe(403);
    expect(fixture.exchange).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});


it('marks only proven pre-persistence apply rejections as not committed', async () => {
  const fixture = await setup();
  try {
    const unauthorized = await fixture.call('/apply', { prepared: {}, mutationId: 'not-dispatched' }, 'expired-synthetic-token');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.payload).toMatchObject({ success: false, requestOutcome: 'not-dispatched' });
    expect(await fixture.repository.readMutation({ rootId: '/root', mutationId: 'not-dispatched' })).toBeUndefined();
    const rejected = await fixture.call('/apply', { prepared: {}, mutationId: 'rejected' });
    expect(rejected.payload).toMatchObject({ success: false, code: 'invalid-input', mutationOutcome: 'not-committed' });
    expect(await fixture.repository.readMutation({ rootId: '/root', mutationId: 'rejected' })).toBeUndefined();
    const denied = await fixture.call('/apply?owner=host', {}, 'member-fixture');
    // The ADR 0049 permission gate rejects it before the route runs.
    expect(denied.status).toBe(403);
    expect(denied.payload).toMatchObject({ code: 'forbidden', requestOutcome: 'not-dispatched' });
    const prepared = await fixture.management.review({ ownerId: 'host', hostAdministrator: true }, { plan: { version: 1 } });
    vi.spyOn(fixture.repository, 'readMutation').mockRejectedValueOnce(new Error('synthetic lookup failure'));
    const unknown = await fixture.call('/apply', { prepared: prepared.prepared, mutationId: 'unknown' });
    expect(unknown.payload).toMatchObject({ success: true, data: { status: 'commit-unknown' } });
    expect(unknown.payload).not.toHaveProperty('mutationOutcome');
  } finally { await fixture.close(); }
});


it('repairs one selected literal template through the Console key payload, opaque preview and authenticated apply', async () => {
  const f = await setup('api-key');
  const expression = '${PRIVATE_KEY:-synthetic-private-default}';
  try {
    const account = f.graph.accounts.account, service = f.graph.services.service, profile = f.graph.profiles.profile;
    const store = new InferenceCredentialStore({ directory: join(f.directory, 'private'), repository: f.repository });
    const record = await store.seal({ account, revision: 1, authContractVersion: '1', payload: {
      status: 'ready', method: 'api-key', key: expression, materialFingerprint: credentialMaterialFingerprint(expression),
    } });
    expect(await f.repository.commitCredential({ rootId: '/root', write: { accountId: account.id, expectedIncarnation: account.incarnation, expectedRevision: 0, record } })).toMatchObject({ status: 'committed' });
    const lookup = vi.fn(() => undefined);
    vi.spyOn(f.accounts.options, 'resolveSource').mockImplementation(source => resolveHostCredentialSource(source, lookup));
    const prepared = await f.call('/key/prepare', { accountId: account.id, expectedRevision: 1, key: expression });
    expect(prepared.status).toBe(200);
    expect(JSON.stringify(prepared.payload)).not.toContain('synthetic-private-default');
    expect(lookup).not.toHaveBeenCalled();
    const applied = await f.call('/apply', { prepared: prepared.payload.data.prepared, mutationId: 'selected-expression-repair' });
    expect(applied.payload).toMatchObject({ success: true, data: { status: 'committed' } });
    expect(JSON.stringify(applied.payload)).not.toContain('synthetic-private-default');
    expect(lookup).not.toHaveBeenCalled();
    const grant = await f.accounts.createPort({
      binding: { graphRevision: f.graph.revision, service, account, profile, model: service.models.example },
      context: { rootId: '/root', ownerId: 'host', hostOwnerId: 'host', operationId: 'selected-repair', sessionKey: 'session' },
      driver: f.definition, retainDriver: () => ({ reference: service.driver, definition: f.definition, release() {} }),
    }).authorize({ target: new URL('https://example.test/v1/messages'), signal: new AbortController().signal });
    expect(grant.token).toBe('synthetic-private-default');
    expect(lookup).toHaveBeenCalledWith('PRIVATE_KEY');
    expect(JSON.stringify((await f.call('')).payload)).not.toContain('synthetic-private-default');
  } finally { await f.close(); }
});
