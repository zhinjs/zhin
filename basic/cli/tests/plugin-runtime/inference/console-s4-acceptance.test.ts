/**
 * ADR 0047 S4 (Console) Host-side acceptance:
 * - local disconnect is reported as a local disconnect, never as upstream revocation;
 * - Console DTOs and log lines carry no access / refresh / OAuth token material;
 * - save (plan + apply) and page / status loads make zero Provider network requests.
 */
import { createHttpHost } from '@zhin.js/host-http';
import { withTestUsers } from '../../utils/console-users.js';
import { MemoryPersonalSessionRepository, PersonalSessionService } from '@zhin.js/agent/personal-session';
import { registerInferenceRoutes } from '../../../src/plugin-runtime/inference/routes.js';
import { resolveInferenceManagementPrincipal } from '@zhin.js/agent/runtime';
import { InferenceSessionManagement } from '@zhin.js/agent/runtime';
import { setupInferenceManagement } from './fixtures.js';

const SECRETS = ['private-synthetic-token', 'private-synthetic-refresh', 'private-fixture-code', 'private-verifier'];
const REVOKED = /revok|upstream|撤销/i;

async function setup() {
  const fixture = await setupInferenceManagement({ method: 'oauth' });
  const providerFetch = vi.fn(async () => new Response('{}', { status: 500 }));
  const options = (fixture.accounts as unknown as { options: { fetch: () => typeof fetch } }).options;
  vi.spyOn(options, 'fetch').mockImplementation(() => providerFetch as unknown as typeof fetch);
  const logs: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      logs.push(String(chunk)); return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write);
  }
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { 'operator-fixture': 'owner' });
  const sessions = new InferenceSessionManagement({ rootId: '/root', hostOwnerId: 'host', owners: [],
    sessions: new PersonalSessionService(new MemoryPersonalSessionRepository()), repository: fixture.repository,
    directory: async () => ({ rows: [], hasMore: false }) });
  registerInferenceRoutes({ http, base: '/api', acquire: () => ({ management: fixture.management, accounts: fixture.accounts, sessions,
    authenticationContract: async () => '1', release() {} }),
    owners: () => [{ id: 'host', label: '部署模型', kind: 'host' }],
    principal: input => resolveInferenceManagementPrincipal({ ...input, hostOwnerId: 'host', bindings: {} }) });
  const { origin } = await http.listen();
  async function call(path: string, body?: unknown) {
    const response = await fetch(`${origin}/api/agent/inference${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer operator-fixture', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, payload: await response.json() };
  }
  async function login() {
    const login = (await call('/login/begin', { accountId: 'account' })).payload.data;
    const completed = await call('/login/complete', { accountId: 'account', loginId: login.loginId,
      callbackUrl: `${login.redirectUri}?code=private-fixture-code&state=fixture-state` });
    expect(completed.payload.data.status).toBe('ready');
    return completed;
  }
  const refresh = fixture.definition.authentication!.oauth!.refresh as ReturnType<typeof vi.fn>;
  function expectNoProviderTraffic() {
    expect(providerFetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  }
  return { ...fixture, call, login, logs, providerFetch, expectNoProviderTraffic,
    async close() { vi.restoreAllMocks(); await http.close(); await fixture.close(); } };
}

afterEach(() => { vi.restoreAllMocks(); });

it('reports POST /disconnect as a local disconnect in the reply and stored state, never as upstream revocation', async () => {
  const f = await setup();
  try {
    await f.login();
    const before = (await f.call('')).payload;
    expect(JSON.stringify(before)).not.toMatch(REVOKED);
    const ready = await f.accounts.status(f.graph.accounts.account!);
    const disconnected = await f.call('/disconnect', { accountId: 'account', expectedRevision: ready.revision });
    expect(disconnected.status).toBe(200);
    expect(disconnected.payload).toMatchObject({ success: true, data: { status: 'disconnected', revision: ready.revision + 1 } });
    expect(JSON.stringify(disconnected.payload)).not.toMatch(REVOKED);
    const stored = await f.store.read(f.graph.accounts.account!);
    expect(stored?.payload.status).toBe('disconnected');
    expect(JSON.stringify(stored?.payload)).not.toMatch(REVOKED);
    for (const secret of SECRETS) expect(JSON.stringify(stored?.payload)).not.toContain(secret);
    const view = (await f.call('')).payload;
    expect(JSON.stringify(view)).toContain('disconnected');
    expect(JSON.stringify(view)).not.toMatch(REVOKED);
    // A local disconnect is a Host action only: no revoke request reaches the Provider.
    f.expectNoProviderTraffic();
  } finally { await f.close(); }
});

it('keeps access, refresh and OAuth token material out of every Console reply and log line', async () => {
  const f = await setup();
  try {
    const replies = [JSON.stringify((await f.call('/login/begin', { accountId: 'account' })).payload)];
    await f.call('/login/cancel', { accountId: 'account', loginId: JSON.parse(replies[0]!).data.loginId });
    replies.push(JSON.stringify((await f.login()).payload));
    for (const path of ['', '/export']) replies.push(JSON.stringify((await f.call(path)).payload));
    const ready = await f.accounts.status(f.graph.accounts.account!);
    replies.push(JSON.stringify((await f.call('/disconnect', { accountId: 'account', expectedRevision: ready.revision })).payload));
    replies.push(JSON.stringify((await f.call('')).payload));
    for (const reply of replies) for (const secret of SECRETS) expect(reply).not.toContain(secret);
    for (const line of f.logs) for (const secret of SECRETS) expect(line).not.toContain(secret);
  } finally { await f.close(); }
});

it('saves (plan + apply) and loads the page / status with zero Provider network requests', async () => {
  const f = await setup();
  try {
    await f.login();
    f.providerFetch.mockClear();
    for (const path of ['', '/export']) expect((await f.call(path)).status).toBe(200);
    await f.accounts.status(f.graph.accounts.account!);
    const planned = await f.call('/plan', { plan: { version: 1 } });
    expect(planned.status).toBe(200);
    const applied = await f.call('/apply', { prepared: planned.payload.data.prepared, mutationId: 's4-save' });
    expect(applied.payload).toMatchObject({ success: true });
    expect((await f.call('')).status).toBe(200);
    f.expectNoProviderTraffic();
  } finally { await f.close(); }
});
