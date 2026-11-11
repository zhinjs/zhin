import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAccount, ProviderDefinition, ProviderGraph, ProviderService } from '@zhin.js/ai/provider';
import { codeOAuth } from '../../../../ai/src/providers/oauth.js';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { DatabaseInferenceRepository } from '@zhin.js/agent/runtime';
import { InferenceCredentialStore } from '@zhin.js/agent/runtime';
import { HostAccountRuntime } from '@zhin.js/agent/runtime';

interface FixtureOptions {
  readonly expiresAt?: number;
  readonly receivedAt?: number;
  readonly fetch?: typeof globalThis.fetch;
}
async function setup(options: FixtureOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'oauth-refresh-policy-'));
  const db = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'state.sqlite') });
  const repository = new DatabaseInferenceRepository({ database: db, normalizeGraph: value => structuredClone(value) as ProviderGraph });
  const account: ProviderAccount = { id: 'account', rootId: '/synthetic', ownerId: 'host', revision: 1,
    serviceId: 'service', incarnation: 'incarnation', authentication: { method: 'oauth' } };
  const service: ProviderService = { id: 'service', rootId: '/synthetic', ownerId: 'host', revision: 1,
    driver: { id: 'fixture', owner: 'fixture', contractVersion: '1' }, options: {}, models: {} };
  const graph: ProviderGraph = { rootId: '/synthetic', revision: 1, services: { service }, accounts: { account }, profiles: {}, purposes: { defaults: {} } };
  const oauth = codeOAuth({ authorizeUrl: 'https://synthetic.invalid/authorize', tokenUrl: 'https://synthetic.invalid/token',
    clientId: 'fixture', redirectUri: 'http://localhost/callback', scopes: 'fixture', encoding: 'form', pkce: true });
  const definition: ProviderDefinition<unknown, unknown> = { id: 'fixture', contractVersion: '1',
    serviceSchema: { parse: value => value }, models: value => value.models, authentication: { methods: ['oauth'], oauth },
    targets: () => ({ authentication: ['https://synthetic.invalid/token'], inference: ['https://synthetic.invalid/v1'] }), createExecution: () => ({}) };
  const fetch = vi.fn<typeof globalThis.fetch>(options.fetch ?? (async () => Response.json({ access_token: 'refreshed-access', refresh_token: 'rotated-refresh', expires_in: 3600 })));
  const store = new InferenceCredentialStore({ directory: join(directory, 'secrets'), repository });
  const clock = { now: 1_000_000 };
  const systemClock = vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  const lease = () => ({ reference: service.driver, definition, release() {} });
  const hosts: HostAccountRuntime[] = [];
  const runtime = () => {
    const host = new HostAccountRuntime({ hostOwnerId: 'host', repository, credentials: store, drivers: { acquire: async () => lease() },
      fetch: () => fetch, allowTarget: () => true, resolveSource: () => undefined, now: () => clock.now });
    hosts.push(host); return host;
  };
  await db.start();
  await repository.commit({ rootId: graph.rootId, expectedRevision: 0, mutationId: 'seed', fingerprint: 'seed', graph, result: null });
  const payload = { status: 'ready', method: 'oauth', credential: { accessToken: 'original-access', refreshToken: 'original-refresh', expiresAt: options.expiresAt ?? 1 },
    ...(options.receivedAt === undefined ? {} : { receivedAt: options.receivedAt }) } as const;
  const record = await store.seal({ account, revision: 1, authContractVersion: '1', payload });
  await repository.commitCredential({ rootId: graph.rootId, write: { accountId: account.id, expectedIncarnation: account.incarnation, expectedRevision: 0, record } });
  const host = runtime();
  const authorize = (current = host) => current.createAccountPort({ account, service, definition, retainDriver: lease, purpose: 'inference' })
    .authorize({ target: new URL('https://synthetic.invalid/v1/request'), signal: new AbortController().signal });
  return { account, graph, repository, store, clock, host, runtime, fetch, authorize,
    async close() { for (const current of hosts) await current.close(); await db.stop(); await rm(directory, { recursive: true, force: true }); systemClock.mockRestore(); } };
}

it('refreshes in the last tenth of a short token lifetime, not immediately after receiving it', async () => {
  const f = await setup({ receivedAt: 1_000_000, expiresAt: 1_060_000 });
  try {
    expect(await f.authorize()).toMatchObject({ token: 'original-access' });
    f.clock.now = 1_053_999;
    expect(await f.authorize()).toMatchObject({ token: 'original-access' });
    expect(f.fetch).not.toHaveBeenCalled();
    f.clock.now = 1_054_000;
    expect(await f.authorize()).toMatchObject({ token: 'refreshed-access' });
    expect((await f.store.read(f.account))?.payload).toMatchObject({ status: 'ready', receivedAt: 1_054_000 });
    expect(await f.authorize()).toMatchObject({ token: 'refreshed-access' });
    expect(f.fetch).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('caps early refresh at five minutes and leaves legacy tokens on their original expiry boundary', async () => {
  for (const receivedAt of [0, undefined]) {
    const f = await setup({ receivedAt, expiresAt: 6_000_000 });
    try {
      f.clock.now = 5_700_000;
      expect(await f.authorize()).toMatchObject({ token: receivedAt === undefined ? 'original-access' : 'refreshed-access' });
      expect(f.fetch).toHaveBeenCalledTimes(receivedAt === undefined ? 0 : 1);
    } finally { await f.close(); }
  }
});

it.each([{ status: 429, error: 'slow_down' }, { status: 400, error: 'slow_down' }])(
  'persists Retry-After cooldown for $status $error across callers and Host restart', async ({ status, error }) => {
    const f = await setup({ fetch: async () => Response.json({ error }, { status, headers: { 'retry-after': '120' } }) });
    try {
      await expect(f.authorize()).rejects.toMatchObject({ code: 'rejected' });
      await expect(f.authorize()).rejects.toMatchObject({ code: 'rejected' });
      await expect(f.authorize(f.runtime())).rejects.toMatchObject({ code: 'rejected' });
      expect(f.fetch).toHaveBeenCalledOnce();
      expect((await f.store.read(f.account))?.payload).toMatchObject({ status: 'ready', refresh: { failures: 1, nextAttemptAt: 1_120_000 } });
      expect(await f.host.status(f.account)).toMatchObject({ status: 'ready', retryAt: 1_120_000 });
      // An unrelated configuration save does not clear private authentication state.
      await f.repository.commit({ rootId: f.graph.rootId, expectedRevision: 1, mutationId: 'label', fingerprint: 'label', graph: { ...f.graph, revision: 2 }, result: null });
      f.clock.now = 1_119_999;
      await expect(f.authorize()).rejects.toMatchObject({ code: 'rejected' });
      expect(f.fetch).toHaveBeenCalledOnce();
      f.clock.now = 1_120_000;
      expect(await f.host.status(f.account)).not.toHaveProperty('retryAt');
      await expect(f.authorize()).rejects.toMatchObject({ code: 'rejected' });
      expect(f.fetch).toHaveBeenCalledTimes(2);
    } finally { await f.close(); }
  }
);

it('uses bounded jittered backoff when a limited response has no usable Retry-After', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const f = await setup({ fetch: async () => Response.json({ error: 'slow_down' }, { status: 429, headers: { 'retry-after': 'invalid' } }) });
  try {
    for (const delay of [500, 1000, 2000, 4000, 5000, 5000]) {
      await expect(f.authorize()).rejects.toMatchObject({ code: 'rejected' });
      const open = await f.store.read(f.account);
      expect(open?.payload).toMatchObject({ refresh: { nextAttemptAt: f.clock.now + delay } });
      const calls = f.fetch.mock.calls.length;
      f.clock.now += delay - 1;
      await expect(f.authorize()).rejects.toMatchObject({ code: 'rejected' });
      expect(f.fetch).toHaveBeenCalledTimes(calls);
      f.clock.now++;
    }
  } finally { random.mockRestore(); await f.close(); }
});

it.each([
  { name: 'explicit temporary OAuth response', response: async () => Response.json({ error: 'server_error', error_description: 'PRIVATE RESPONSE' }, { status: 503 }), cause: 'temporary-response', status: 503 },
  { name: 'unknown transport outcome', response: async () => { throw new TypeError('PRIVATE NETWORK'); }, cause: 'transport-unknown', status: undefined },
])('retains encrypted recovery material without replaying $name', async ({ response, cause, status }) => {
  const f = await setup({ fetch: response });
  try {
    await expect(f.authorize()).rejects.toMatchObject({ code: 'outcome-unknown' });
    const open = await f.store.read(f.account);
    expect(open?.payload).toMatchObject({ status: 'uncertain', failure: { kind: cause, ...(status === undefined ? {} : { status }) },
      recovery: { credential: { accessToken: 'original-access', refreshToken: 'original-refresh' } } });
    expect(open?.payload).not.toHaveProperty('credential');
    expect(JSON.stringify(open?.record)).not.toMatch(/original-access|original-refresh|PRIVATE/);
    await expect(f.authorize(f.runtime())).rejects.toMatchObject({ code: 'outcome-unknown' });
    expect(f.fetch).toHaveBeenCalledOnce();
    const view = JSON.stringify(await f.host.status(f.account));
    expect(view).not.toMatch(/original-access|original-refresh|PRIVATE|recovery/);
    expect(view).toContain(cause);
  } finally { await f.close(); }
});

it('preserves private recovery material while a refresh is pending, and disconnect defeats late results', async () => {
  let finish!: (response: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const f = await setup({ fetch: async () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
  try {
    const pending = f.authorize();
    const denied = expect(pending).rejects.toMatchObject({ code: 'outcome-unknown' });
    await started;
    const open = await f.store.read(f.account);
    expect(open?.payload).toMatchObject({ status: 'exchange-pending', recovery: { credential: { refreshToken: 'original-refresh' } } });
    await f.host.disconnect({ account: f.account, expectedRevision: open!.record.revision, authContractVersion: '1' });
    finish(Response.json({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 }));
    await denied;
    expect((await f.store.read(f.account))?.payload).toMatchObject({ status: 'disconnected' });
    expect((await f.store.read(f.account))?.payload).not.toHaveProperty('recovery');
  } finally { await f.close(); }
});
