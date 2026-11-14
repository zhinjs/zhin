/**
 * #1250 host-account-add-path / console-account-env-key-impossible / account-env-ref-immutable:
 * who may make a Host account read a Host environment variable, through which route, and what
 * leaves the Host (never a value).
 */
import { createHttpHost } from '@zhin.js/host-http/node';
import { LOCAL_SOCKET_CREDENTIAL_ID, LOCAL_SOCKET_USER_ID, type ConsoleUserPrincipal } from '@zhin.js/host-http';
import { CONSOLE_PERMISSION_LIST } from '@zhin.js/console-protocol';
import { MemoryPersonalSessionRepository, PersonalSessionService } from '@zhin.js/agent/personal-session';
import {
  InferenceManagementService,
  InferenceSessionManagement,
  credentialMaterialFingerprint,
  resolveInferenceManagementPrincipal,
  type InferenceProbeResult,
} from '@zhin.js/agent/runtime';
import { join } from 'node:path';
import { registerInferenceRoutes } from '../../../src/instance/inference/routes.js';
import { installTestConsoleUsers } from '../utils/console-users.js';
import { setupInferenceManagement } from './fixtures.js';

const OFFICIAL = 'https://api.fixture.test/v1';
const SECRET = 'sk-synthetic-host-secret-never-echoed';
const OTHER_SECRET = 'sk-synthetic-rotated-secret-never-echoed';

const localCli: ConsoleUserPrincipal = Object.freeze({
  kind: 'user', userId: LOCAL_SOCKET_USER_ID, username: 'local', displayName: '本机 CLI', credentialId: LOCAL_SOCKET_CREDENTIAL_ID,
  grants: Object.freeze([{ role: 'owner', scope: { kind: 'global' } as const, permissions: CONSOLE_PERMISSION_LIST }]),
  roles: Object.freeze(['owner']),
});

async function setup(input: Readonly<{ probe?: (profileId: string) => InferenceProbeResult }> = {}) {
  const fixture = await setupInferenceManagement({ method: 'api-key' });
  // The built-in Driver's official address is its schema default; a plan may omit it.
  const management = new InferenceManagementService({ rootId: '/root', hostOwnerId: 'host', directory: join(fixture.directory, 'private'),
    repository: fixture.repository, accounts: fixture.accounts, authenticationContract: () => '1',
    profileSchema: () => undefined, discover: async () => [], drivers: () => [],
    resolveService: value => ({ driver: fixture.graph.services.service!.driver,
      options: { baseUrl: OFFICIAL, ...(value.options as object) } as never,
      models: Object.keys(value.models).length ? value.models : fixture.graph.services.service!.models }) });
  fixture.resolveSource.mockImplementation(source => source === 'env://OPENAI_API_KEY' ? SECRET
    : source === 'env://ROTATED_API_KEY' ? OTHER_SECRET : source === 'env://SAME_API_KEY' ? SECRET : undefined);
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const audits = installTestConsoleUsers(http, { owner: 'owner', admin: 'admin', local: localCli });
  const sessions = new InferenceSessionManagement({ rootId: '/root', hostOwnerId: 'host', owners: [],
    sessions: new PersonalSessionService(new MemoryPersonalSessionRepository()), repository: fixture.repository,
    directory: async () => ({ rows: [], hasMore: false }) });
  const probe = vi.fn(async ({ profileId }: { profileId: string }) => input.probe?.(profileId)
    ?? { status: 'ok' as const, durationMs: 1, at: 1, profileId });
  registerInferenceRoutes({ http, base: '/api', acquire: () => ({ management, accounts: fixture.accounts, sessions,
    authenticationContract: async () => '1', probe, release() {} }),
    owners: () => [{ id: 'host', label: '部署模型', kind: 'host' }],
    principal: value => resolveInferenceManagementPrincipal({ ...value, hostOwnerId: 'host', bindings: {} }),
    audit: entry => { audits.push(entry); } });
  const { origin } = await http.listen();
  async function call(path: string, body: unknown, token: string) {
    const response = await fetch(`${origin}/api/agent/inference${path}`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, payload: await response.json() };
  }
  async function importPlan(plan: unknown, token: string, bindings?: unknown) {
    const reviewed = await call('/plan', { plan, ...(bindings ? { bindings } : {}) }, token);
    if (reviewed.status !== 200) return reviewed;
    return call('/apply', { prepared: reviewed.payload.data.prepared, mutationId: `m-${Math.random()}` }, token);
  }
  return { ...fixture, management, call, importPlan, audits, probe,
    async close() { await http.close(); await fixture.close(); } };
}

function envAccount(variable: string, service = 'shared') {
  return { version: 1, accounts: { created: { service, label: '新账号', auth: { method: 'api-key', source: `env://${variable}` } } } };
}

it('refuses Host environment references from a Console user who is not a global owner, with a clear reason', async () => {
  const f = await setup();
  try {
    const denied = await f.call('/plan', { plan: envAccount('OPENAI_API_KEY'), bindings: { services: { shared: 'service' } } }, 'admin');
    expect(denied.status).toBe(403);
    expect(denied.payload).toMatchObject({ code: 'forbidden', reason: 'environment-console-user' });
    expect(denied.payload.error).toContain('Console 用户的账号不能引用 Host 环境变量');
    const key = await f.call('/key/prepare', { accountId: 'account', expectedRevision: 0, key: '${OPENAI_API_KEY:-fallback}' }, 'admin');
    expect(key.status).toBe(403);
    expect(key.payload.reason).toBe('environment-console-user');
    // Plain keys stay available to every Console user with the permission.
    expect((await f.call('/key/prepare', { accountId: 'account', expectedRevision: 0, key: 'sk-console-direct' }, 'admin')).status).toBe(200);
    expect(f.resolveSource).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it('lets a global owner import a Host account only for *_API_KEY toward an existing or official service', async () => {
  const f = await setup();
  try {
    const name = await f.call('/plan', { plan: envAccount('HTTP_TOKEN'), bindings: { services: { shared: 'service' } } }, 'owner');
    expect(name.payload).toMatchObject({ code: 'forbidden', reason: 'environment-name' });
    for (const variable of ['DB_SECRET', 'ADMIN_PASSWORD', 'ZHIN_CONSOLE_TOKEN'])
      expect((await f.call('/plan', { plan: envAccount(variable), bindings: { services: { shared: 'service' } } }, 'owner')).payload.reason).toBe('environment-name');
    const custom = await f.call('/plan', { plan: { version: 1, services: { evil: { driver: 'fixture', options: { baseUrl: 'https://collector.example/v1' }, models: {} } },
      accounts: { created: { service: 'evil', auth: { method: 'api-key', source: 'env://OPENAI_API_KEY' } } } } }, 'owner');
    expect(custom.payload).toMatchObject({ code: 'forbidden', reason: 'environment-service-address' });
    expect(custom.payload.error).toContain('官方地址');
    const official = await f.importPlan({ version: 1, services: { official: { driver: 'fixture', options: {}, models: {} } },
      accounts: { created: { service: 'official', auth: { method: 'api-key', source: 'env://OPENAI_API_KEY' } } } }, 'owner');
    expect(official.payload).toMatchObject({ success: true, data: { status: 'committed' } });
    const existing = await f.importPlan(envAccount('OPENAI_API_KEY'), 'owner', { services: { shared: 'service' } });
    expect(existing.payload).toMatchObject({ success: true, data: { status: 'committed' } });
    expect(f.resolveSource).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it('adds a Host env account only over the local CLI channel, audits it and never echoes the value', async () => {
  const f = await setup();
  try {
    for (const token of ['owner', 'admin']) {
      const denied = await f.call('/cli/account/add', { service: 'service', env: 'OPENAI_API_KEY' }, token);
      expect(denied.status).toBe(403);
      expect(denied.payload).toMatchObject({ reason: 'environment-local-only' });
    }
    // The local CLI is the Host administrator on this machine: any variable name, no address rule.
    const added = await f.call('/cli/account/add', { service: 'service', env: 'OPENAI_API_KEY', label: 'CLI 账号' }, 'local');
    expect(added.payload).toMatchObject({ success: true, data: { serviceId: 'service', createdService: false, result: { status: 'committed' } } });
    const graph = (await f.repository.readGraph({ rootId: '/root' }))!;
    expect(graph.accounts[added.payload.data.accountId]).toMatchObject({ ownerId: 'host', label: 'CLI 账号',
      authentication: { method: 'api-key', source: 'env://OPENAI_API_KEY' } });
    const audit = f.audits.filter(entry => entry.action.startsWith('inference.cli'));
    expect(audit).toEqual([
      expect.objectContaining({ actor: 'user:owner', action: 'inference.cli.account.add', outcome: 'denied' }),
      expect.objectContaining({ actor: 'user:admin', action: 'inference.cli.account.add', outcome: 'denied' }),
      expect.objectContaining({ actor: 'user:local', action: 'inference.cli.account.add', outcome: 'ok',
        target: added.payload.data.accountId, detail: expect.objectContaining({ env: 'OPENAI_API_KEY' }) }),
    ]);
    expect(JSON.stringify(f.audits) + JSON.stringify(added.payload)).not.toContain(SECRET);
  } finally { await f.close(); }
});

it('shows an env-backed Host account without a credential as environment-ready, then activates it on a connection test', async () => {
  const f = await setup();
  try {
    const added = await f.call('/cli/account/add', { service: 'service', env: 'OPENAI_API_KEY' }, 'local');
    const id = added.payload.data.accountId as string;
    const account = (await f.repository.readGraph({ rootId: '/root' }))!.accounts[id]!;
    expect(await f.accounts.status(account)).toEqual({ status: 'not-authorized', revision: 0, environment: 'present' });
    f.resolveSource.mockReturnValue(undefined);
    expect(await f.accounts.status(account)).toEqual({ status: 'not-authorized', revision: 0, environment: 'missing' });
    // An account without a language profile cannot be tested.
    const untested = await f.call('/account/test', { accountId: id }, 'owner');
    expect(untested.status).toBe(422);
    const tested = await f.call('/account/test', { accountId: 'account' }, 'owner');
    expect(tested.payload).toMatchObject({ success: true, data: { result: { status: 'ok', profileId: 'profile' } } });
    expect(f.probe).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'profile' }));
    expect(f.audits.some(entry => entry.action === 'inference.account.test' && entry.outcome === 'ok')).toBe(true);
    expect(JSON.stringify(f.audits)).not.toContain(SECRET);
  } finally { await f.close(); }
});

it('renames the env reference of a Host account keeping its identity, and re-authorizes only on request', async () => {
  const f = await setup();
  try {
    const added = await f.call('/cli/account/add', { service: 'service', env: 'OPENAI_API_KEY' }, 'local');
    const id = added.payload.data.accountId as string;
    const before = (await f.repository.readGraph({ rootId: '/root' }))!.accounts[id]!;
    // Activate the credential through the real authorization path (fingerprint of OPENAI_API_KEY).
    const service = (await f.repository.readGraph({ rootId: '/root' }))!.services.service!;
    await f.accounts.createPort({ binding: { graphRevision: 0, service, account: before, profile: f.graph.profiles.profile!, model: service.models.example! },
      context: { rootId: '/root', ownerId: 'host', hostOwnerId: 'host', operationId: 'activate', sessionKey: 's' },
      driver: f.definition, retainDriver: () => ({ reference: service.driver, definition: f.definition, release() {} }),
    }).authorize({ target: new URL('https://example.test/v1/chat'), signal: new AbortController().signal });
    const open = await f.store.read(before);
    expect(open?.payload).toMatchObject({ status: 'ready', materialFingerprint: credentialMaterialFingerprint(SECRET) });

    expect((await f.call('/cli/account/rename-env', { account: id, from: 'OPENAI_API_KEY', to: 'ROTATED_API_KEY' }, 'admin')).payload.reason).toBe('environment-local-only');
    expect((await f.call('/cli/account/rename-env', { account: id, from: 'WRONG_API_KEY', to: 'SAME_API_KEY' }, 'local')).payload.reason).toBe('environment-account');
    expect((await f.call('/cli/account/rename-env', { account: id, from: 'OPENAI_API_KEY', to: 'UNSET_API_KEY' }, 'local')).payload.reason).toBe('environment-missing');
    const mismatch = await f.call('/cli/account/rename-env', { account: id, from: 'OPENAI_API_KEY', to: 'ROTATED_API_KEY' }, 'local');
    expect(mismatch.status).toBe(409);
    expect(mismatch.payload.reason).toBe('environment-mismatch');

    const kept = await f.call('/cli/account/rename-env', { account: id, from: 'OPENAI_API_KEY', to: 'SAME_API_KEY' }, 'local');
    expect(kept.payload).toMatchObject({ success: true, data: { accountId: id, credential: 'kept', result: { status: 'committed' } } });
    let after = (await f.repository.readGraph({ rootId: '/root' }))!.accounts[id]!;
    expect(after).toMatchObject({ id, incarnation: before.incarnation, authentication: { source: 'env://SAME_API_KEY' } });
    expect((await f.store.read(after))?.payload.status).toBe('ready');

    const reset = await f.call('/cli/account/rename-env', { account: id, from: 'SAME_API_KEY', to: 'ROTATED_API_KEY', reauthorize: true }, 'local');
    expect(reset.payload).toMatchObject({ success: true, data: { credential: 'reset' } });
    after = (await f.repository.readGraph({ rootId: '/root' }))!.accounts[id]!;
    expect(after.incarnation).toBe(before.incarnation);
    const pending = await f.store.read(after);
    expect(pending?.payload).toEqual({ status: 'reauthorize', method: 'api-key' });
    expect(await f.accounts.status(after)).toMatchObject({ status: 'not-authorized', environment: 'present' });
    // The next authorization reads ROTATED_API_KEY and establishes its fingerprint as the identity.
    const grant = await f.accounts.createPort({ binding: { graphRevision: 0, service, account: after, profile: f.graph.profiles.profile!, model: service.models.example! },
      context: { rootId: '/root', ownerId: 'host', hostOwnerId: 'host', operationId: 'reactivate', sessionKey: 's' },
      driver: f.definition, retainDriver: () => ({ reference: service.driver, definition: f.definition, release() {} }),
    }).authorize({ target: new URL('https://example.test/v1/chat'), signal: new AbortController().signal });
    expect(grant.token).toBe(OTHER_SECRET);
    expect((await f.store.read(after))?.payload).toMatchObject({ status: 'ready', materialFingerprint: credentialMaterialFingerprint(OTHER_SECRET) });
    const everything = JSON.stringify([f.audits, kept.payload, reset.payload, mismatch.payload, await f.accounts.status(after)]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(OTHER_SECRET);
    expect(f.audits.filter(entry => entry.action === 'inference.cli.account.rename-env' && entry.outcome === 'ok')).toHaveLength(2);
  } finally { await f.close(); }
});

it('shows the latest real call outcome on the account status (class, HTTP status and time only)', async () => {
  const f = await setup();
  try {
    const account = f.graph.accounts.account!;
    const responses = [new Response('{"error":"synthetic-provider-body"}', { status: 401 }), new Response('{}', { status: 200 })];
    const observed = f.accounts.observeCalls(account, async () => responses.shift()!);
    await observed('https://example.test/v1/chat');
    expect((await f.accounts.status(account)).lastCall).toEqual({ outcome: 'auth', status: 401, at: expect.any(Number) });
    await observed('https://example.test/v1/chat');
    expect((await f.accounts.status(account)).lastCall).toMatchObject({ outcome: 'ok', status: 200 });
    const timedOut = f.accounts.observeCalls(account, async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); });
    await expect(timedOut('https://example.test/v1/chat')).rejects.toThrow();
    expect((await f.accounts.status(account)).lastCall).toMatchObject({ outcome: 'timeout' });
    // Caller cancellation is not a provider outcome.
    const cancelled = f.accounts.observeCalls(account, async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); });
    await expect(cancelled('https://example.test/v1/chat')).rejects.toThrow();
    expect((await f.accounts.status(account)).lastCall).toMatchObject({ outcome: 'timeout' });
    expect(JSON.stringify(await f.accounts.status(account))).not.toContain('synthetic-provider-body');
  } finally { await f.close(); }
});

it('tells the Console view whether the caller may reference Host environment variables', async () => {
  const f = await setup();
  try {
    const owner = await f.management.view({ ownerId: 'host', hostAdministrator: true, environmentReferences: 'console-owner' });
    expect(owner.environmentReferences).toBe('console-owner');
    const admin = await f.management.view({ ownerId: 'host', hostAdministrator: true, environmentReferences: 'none' });
    expect(admin.environmentReferences).toBe('none');
  } finally { await f.close(); }
});
