import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  OAuthCredential, ProviderAccount, ProviderDefinition, ProviderDriverLease, ProviderExecutionContext, ProviderGraph,
} from '@zhin.js/ai/provider';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { DatabaseInferenceRepository } from '../../../src/plugin-runtime/inference/repository.js';
import { InferenceCredentialStore } from '../../../src/plugin-runtime/inference/credentials.js';
import { HostAccountRuntime } from '../../../src/plugin-runtime/inference/account-runtime.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(method: 'api-key' | 'oauth' | 'none', source?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'inference-account-'));
  const db = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'state.sqlite') });
  const repo = new DatabaseInferenceRepository({ database: db, normalizeGraph: value => structuredClone(value) as ProviderGraph });
  const account: ProviderAccount = { id: 'account', rootId: '/root', ownerId: 'host', revision: 1,
    serviceId: 'service', incarnation: 'account-incarnation', authentication: method === 'oauth' ? { method } : { method, ...(source ? { source } : {}) } };
  const service = { id: 'service', rootId: '/root', ownerId: 'host', revision: 1,
    driver: { id: 'fixture', owner: 'root/provider', contractVersion: '1' }, options: {}, models: {} };
  const graph: ProviderGraph = { rootId: '/root', revision: 1, services: { service }, accounts: { account }, profiles: {}, purposes: { defaults: {} } };
  const refresh = vi.fn(async (): Promise<OAuthCredential> => ({ accessToken: 'new-access', refreshToken: 'rotated-refresh', expiresAt: 5000 }));
  const complete = vi.fn(async (): Promise<OAuthCredential> => ({ accessToken: 'logged-in', refreshToken: 'login-refresh', expiresAt: 5000 }));
  const prepare = vi.fn(async ({ credential }: { credential: OAuthCredential }): Promise<OAuthCredential> => ({ ...credential,
    subject: 'verified-subject', preparation: { status: 'ready' }, metadata: { projectId: 'real-synthetic-project' } }));
  const release = vi.fn(async () => {});
  const definition: ProviderDefinition<unknown, unknown> = { id: 'fixture', contractVersion: '1',
    serviceSchema: { parse: input => input }, authentication: { methods: [method], ...(method === 'oauth' ? { oauth: {
      contractVersion: '1', redirectUri: 'http://localhost:1455/auth/callback', begin: async () => ({ authorizationUrl: 'https://provider.example/authorize', state: 'synthetic-state', privateState: { verifier: 'private-verifier' } }),
      complete, refresh, prepare,
    } } : {}) },
    targets: () => ({ authentication: ['https://provider.example/token'], inference: ['https://provider.example/v1'] }),
    createExecution: () => ({}),
  };
  const lease = (): ProviderDriverLease => ({ reference: service.driver, definition, release });
  const store = new InferenceCredentialStore({ directory: join(directory, 'secrets'), repository: repo });
  const environment = { key: 'environment-key-one' };
  const resolveSource = vi.fn(() => environment.key);
  const runtime = () => new HostAccountRuntime({ hostOwnerId: 'host', repository: repo, credentials: store, drivers: { acquire: async () => lease() },
    fetch: () => vi.fn(async () => new Response('{}')),
    allowTarget: ({ target }) => target.origin === 'https://provider.example', resolveSource, now: () => 1000 });
  const host = runtime();
  const execution: ProviderExecutionContext = { binding: { graphRevision: 1, account, service,
    model: { id: 'model', kinds: ['language'], protocol: 'fixture' },
    profile: { id: 'profile', rootId: '/root', ownerId: 'host', revision: 1, accountId: 'account', model: 'model', parameters: {} } },
    context: { rootId: '/root', ownerId: 'host', hostOwnerId: 'host', operationId: 'operation', sessionKey: 'session' },
    driver: definition, retainDriver: lease };
  await db.start();
  await repo.commit({ rootId: '/root', expectedRevision: 0, mutationId: 'initial', fingerprint: 'initial', graph, result: null });
  const seed = async (credential: OAuthCredential) => {
    const record = await store.seal({ account, revision: 1, authContractVersion: '1', payload: { status: 'ready', method: 'oauth', credential } });
    expect(await repo.commitCredential({ rootId: '/root', write: { accountId: account.id, expectedRevision: 0, expectedIncarnation: account.incarnation, record } })).toEqual({ status: 'committed' });
  };
  const request = (signal = new AbortController().signal) => ({ target: new URL('https://provider.example/v1/request'), signal });
  return { db, repo, account, graph, store, host, runtime, execution, definition, environment, resolveSource, refresh, complete, prepare, release, seed, request,
    async close() { await host.close(); await db.stop(); await rm(directory, { recursive: true, force: true }); } };
}

it('keeps real API key material encrypted and validates the bound owner and request target', async () => {
  const fixture = await setup('api-key');
  try {
    await fixture.host.putKey({ account: fixture.account, key: 'private-synthetic-api-key', expectedRevision: 0, authContractVersion: '1' });
    const record = await fixture.repo.readCredential({ rootId: '/root', accountId: 'account' });
    expect(JSON.stringify(record)).not.toContain('private-synthetic-api-key');
    expect(await fixture.host.createPort(fixture.execution).authorize(fixture.request())).toMatchObject({ token: 'private-synthetic-api-key', revision: '1' });
    await expect(fixture.host.createPort(fixture.execution).authorize({ ...fixture.request(), target: new URL('https://other.example') }))
      .rejects.toMatchObject({ code: 'target-denied' });
    await expect(fixture.store.read({ ...fixture.account, ownerId: 'another-owner' })).rejects.toMatchObject({ code: 'integrity' });
    expect((await fixture.repo.readGraph({ rootId: '/root' }))?.revision).toBe(1);
  } finally { await fixture.close(); }
});

it('projects a no-authentication account as ready without reading or inventing credentials', async () => {
  const fixture = await setup('none'), read = vi.spyOn(fixture.store, 'read');
  try {
    expect(await fixture.host.status(fixture.account)).toEqual({ status: 'ready', revision: 0 });
    expect(await fixture.host.createPort(fixture.execution).authorize(fixture.request())).toEqual({ headers: {}, revision: 'none' });
    expect(read).not.toHaveBeenCalled(); expect(fixture.resolveSource).not.toHaveBeenCalled();
    expect(await fixture.repo.readCredential({ rootId: '/root', accountId: fixture.account.id })).toBeUndefined();
  } finally { await fixture.close(); }
});

it('persists an exchanged token before read-only preparation and retries preparation without replaying exchange', async () => {
  const fixture = await setup('oauth');
  fixture.complete.mockResolvedValue({ accessToken: 'logged-in', refreshToken: 'login-refresh', expiresAt: 5000, preparation: { status: 'required' } });
  fixture.prepare.mockRejectedValueOnce(new Error('synthetic read-only lookup unavailable'));
  try {
    const signal = new AbortController().signal, login = await fixture.host.beginLogin({ account: fixture.account, signal });
    await fixture.host.completeLogin({ account: fixture.account, ...login, code: 'synthetic-code', signal });
    expect(await fixture.host.status(fixture.account)).toEqual({ status: 'authenticated', preparation: 'required', revision: 2 });
    expect((await fixture.store.read(fixture.account))?.payload).toMatchObject({ status: 'ready', credential: { accessToken: 'logged-in' } });
    await expect(fixture.host.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'not-prepared' });
    await fixture.host.prepareLogin({ account: fixture.account, expectedRevision: 2, signal });
    expect(await fixture.host.status(fixture.account)).toEqual({ status: 'ready', revision: 3 });
    expect(await fixture.host.createPort(fixture.execution).authorize(fixture.request())).toMatchObject({ token: 'logged-in', metadata: { projectId: 'real-synthetic-project' } });
    expect(fixture.complete).toHaveBeenCalledOnce(); expect(fixture.prepare).toHaveBeenCalledTimes(2);
    expect(fixture.refresh).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});

it('does not reinterpret a token through a different OAuth authentication contract during preparation', async () => {
  const fixture = await setup('oauth');
  try {
    await fixture.seed({ accessToken: 'existing', refreshToken: 'refresh', preparation: { status: 'required' } });
    Object.defineProperty(fixture.definition.authentication.oauth!, 'contractVersion', { value: 'different-contract' });
    await expect(fixture.host.prepareLogin({ account: fixture.account, expectedRevision: 1, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(fixture.prepare).not.toHaveBeenCalled(); expect(fixture.complete).not.toHaveBeenCalled();
    expect(await fixture.host.status(fixture.account)).toEqual({ status: 'authenticated', preparation: 'required', revision: 1 });
  } finally { await fixture.close(); }
});

it('a cancelled old exchange cannot remove the ownership of a newer pending login', async () => {
  const fixture = await setup('oauth'), entered = deferred<void>(), response = deferred<OAuthCredential>();
  fixture.complete.mockImplementationOnce(async () => { entered.resolve(); return response.promise; });
  try {
    const signal = new AbortController().signal;
    const oldLogin = await fixture.host.beginLogin({ account: fixture.account, signal });
    const completion = fixture.host.completeLogin({ account: fixture.account, ...oldLogin, code: 'old', signal });
    const rejected = expect(completion).rejects.toMatchObject({ code: 'outcome-unknown' });
    await entered.promise; await fixture.host.cancelLogin({ account: fixture.account, loginId: oldLogin.loginId });
    const replacement = await fixture.host.beginLogin({ account: fixture.account, signal });
    response.resolve({ accessToken: 'cancelled-late', refreshToken: 'late-refresh' }); await rejected;
    expect(await fixture.host.beginLogin({ account: fixture.account, signal })).toEqual(replacement);
    expect(fixture.release).toHaveBeenCalledOnce();
    await fixture.host.cancelLogin({ account: fixture.account, loginId: replacement.loginId });
    expect(fixture.release).toHaveBeenCalledTimes(2);
  } finally { await fixture.close(); }
});

it('accepts a declared lowercase Host environment reference but rejects personal environment access before resolution', async () => {
  const fixture = await setup('api-key', 'env://synthetic_Key');
  try {
    expect(await fixture.host.createPort(fixture.execution).authorize(fixture.request())).toMatchObject({ token: 'environment-key-one' });
    expect(fixture.resolveSource).toHaveBeenCalledOnce(); fixture.resolveSource.mockClear();
    const account = { ...fixture.account, ownerId: 'personal' };
    await fixture.repo.commit({ rootId: '/root', expectedRevision: 1, mutationId: 'personal', fingerprint: 'personal',
      graph: { ...fixture.graph, revision: 2, accounts: { account } }, result: null });
    const execution = { ...fixture.execution, binding: { ...fixture.execution.binding, account } };
    await expect(fixture.host.createPort(execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'not-authorized' });
    expect(fixture.resolveSource).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});

it('does not replace a disconnected account identity with an unverified different API key', async () => {
  const fixture = await setup('api-key');
  try {
    await fixture.host.putKey({ account: fixture.account, key: 'first-key', expectedRevision: 0, authContractVersion: '1' });
    await fixture.host.disconnect({ account: fixture.account, expectedRevision: 1, authContractVersion: '1' });
    await expect(fixture.host.putKey({ account: fixture.account, key: 'changed-key', expectedRevision: 2, authContractVersion: '1' }))
      .rejects.toMatchObject({ code: 'identity-change' });
    expect(await fixture.host.status(fixture.account)).toMatchObject({ status: 'disconnected' });
  } finally { await fixture.close(); }
});

it('keeps a successful refresh result when releasing its Driver lease fails', async () => {
  const fixture = await setup('oauth');
  fixture.release.mockRejectedValue(new Error('synthetic cleanup failure'));
  try {
    await fixture.seed({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 1 });
    expect(await fixture.host.createPort(fixture.execution).authorize(fixture.request())).toMatchObject({ token: 'new-access' });
    expect(await fixture.host.status(fixture.account)).toMatchObject({ status: 'ready' });
    expect(fixture.refresh).toHaveBeenCalledOnce();
  } finally { await fixture.close(); }
});

it('completes a pasted exact callback once and rejects a wrong URI, state or account before exchanging', async () => {
  const fixture = await setup('oauth');
  try {
    const signal = new AbortController().signal;
    const login = await fixture.host.beginLogin({ account: fixture.account, signal });
    expect(login.redirectUri).toBe('http://localhost:1455/auth/callback');
    for (const callbackUrl of ['http://localhost:1455/wrong?code=c&state=synthetic-state',
      'https://evil.test/auth/callback?code=c&state=synthetic-state', 'http://localhost:1455/auth/callback?code=c&state=wrong']) {
      await expect(fixture.host.completeCallback({ account: fixture.account, loginId: login.loginId, callbackUrl, signal })).rejects.toMatchObject({ code: 'not-authorized' });
    }
    await expect(fixture.host.completeCallback({ account: { ...fixture.account, id: 'another' }, loginId: login.loginId,
      callbackUrl: 'http://localhost:1455/auth/callback?code=c&state=synthetic-state', signal })).rejects.toMatchObject({ code: 'not-authorized' });
    expect(fixture.complete).not.toHaveBeenCalled();
    await fixture.host.completeCallback({ account: fixture.account, loginId: login.loginId,
      callbackUrl: 'http://localhost:1455/auth/callback?code=c&state=synthetic-state', signal });
    expect(fixture.complete).toHaveBeenCalledOnce();
    await expect(fixture.host.completeCallback({ account: fixture.account, loginId: login.loginId,
      callbackUrl: 'http://localhost:1455/auth/callback?code=c&state=synthetic-state', signal })).rejects.toMatchObject({ code: 'not-authorized' });
    expect(fixture.complete).toHaveBeenCalledOnce();
  } finally { await fixture.close(); }
});

it('cannot reactivate a cancelled in-flight login when its provider ignores the cancellation signal', async () => {
  const fixture = await setup('oauth'), entered = deferred<void>(), response = deferred<OAuthCredential>();
  fixture.complete.mockImplementation(async () => { entered.resolve(); return response.promise; });
  try {
    const signal = new AbortController().signal, login = await fixture.host.beginLogin({ account: fixture.account, signal });
    const completion = fixture.host.completeLogin({ account: fixture.account, ...login, code: 'synthetic-code', signal });
    const rejected = expect(completion).rejects.toMatchObject({ code: 'outcome-unknown' });
    await entered.promise;
    await fixture.host.cancelLogin({ account: fixture.account, loginId: login.loginId });
    response.resolve({ accessToken: 'late-token', refreshToken: 'late-refresh' });
    await rejected;
    expect(await fixture.host.status(fixture.account)).toMatchObject({ status: 'uncertain' });
    await expect(fixture.host.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'outcome-unknown' });
    expect(fixture.complete).toHaveBeenCalledOnce();
  } finally { await fixture.close(); }
});

it('does not treat a changed environment key as the same account across a rebuilt Host runtime', async () => {
  const fixture = await setup('api-key', 'env://SYNTHETIC_KEY');
  try {
    expect(await fixture.host.createPort(fixture.execution).authorize(fixture.request())).toMatchObject({ token: 'environment-key-one' });
    fixture.environment.key = 'environment-key-two';
    const rebuilt = fixture.runtime();
    try {
      await expect(rebuilt.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'identity-change' });
      expect(await rebuilt.status(fixture.account)).toEqual({ status: 'reauthorize', revision: 2 });
      await expect(rebuilt.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'reauthorize' });
    } finally { await rebuilt.close(); }
  } finally { await fixture.close(); }
});

it('refreshes once for concurrent callers and retains the exact Driver after the first waiter is cancelled', async () => {
  const fixture = await setup('oauth');
  const entered = deferred<void>(), result = deferred<OAuthCredential>();
  fixture.refresh.mockImplementation(async () => { entered.resolve(); return result.promise; });
  try {
    await fixture.seed({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1 });
    const cancelled = new AbortController();
    const first = fixture.host.createPort(fixture.execution).authorize(fixture.request(cancelled.signal));
    const denied = expect(first).rejects.toBeInstanceOf(Error);
    await entered.promise;
    const second = fixture.host.createPort(fixture.execution).authorize(fixture.request());
    cancelled.abort(new Error('one caller cancelled'));
    await denied;
    expect(fixture.refresh).toHaveBeenCalledOnce(); expect(fixture.release).not.toHaveBeenCalled();
    result.resolve({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 5000 });
    expect(await second).toMatchObject({ token: 'new-access', revision: '3' });
    expect(fixture.release).toHaveBeenCalledOnce();
    expect((await fixture.repo.readGraph({ rootId: '/root' }))?.revision).toBe(1);
    expect(await fixture.host.createPort(fixture.execution).authorize(fixture.request())).toMatchObject({ token: 'new-access' });
    expect(fixture.refresh).toHaveBeenCalledOnce();
  } finally { await fixture.close(); }
});

it('persists unknown external refresh outcomes without retrying on a later or rebuilt operation', async () => {
  const fixture = await setup('oauth');
  fixture.refresh.mockRejectedValue(Object.assign(new Error('private upstream body is not exposed'), { code: 'outcome-unknown' }));
  try {
    await fixture.seed({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1 });
    await expect(fixture.host.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'outcome-unknown' });
    const rebuilt = fixture.runtime();
    try {
      await expect(rebuilt.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'outcome-unknown' });
      expect(fixture.refresh).toHaveBeenCalledOnce();
      expect(await rebuilt.status(fixture.account)).toEqual({ status: 'uncertain', revision: 3 });
    } finally { await rebuilt.close(); }
  } finally { await fixture.close(); }
});

it('retains the original identity and an uncertain outcome when refresh proves a different subject', async () => {
  const fixture = await setup('oauth');
  fixture.refresh.mockResolvedValue({
    accessToken: 'subject-b-token',
    refreshToken: 'rotated-b',
    expiresAt: 5000,
    subject: 'subject-b',
  });
  try {
    await fixture.seed({
      accessToken: 'expired-a',
      refreshToken: 'refresh-a',
      expiresAt: 1,
      subject: 'subject-a',
    });
    await expect(
      fixture.host.createPort(fixture.execution).authorize(fixture.request())
    ).rejects.toMatchObject({ code: 'identity-change' });
    const saved = await fixture.store.read(fixture.account);
    expect(saved?.payload).toMatchObject({ status: 'uncertain', subject: 'subject-a' });
    expect(saved?.payload).not.toHaveProperty('credential');
    expect(saved?.record.incarnation).toBe(fixture.account.incarnation);
    const rebuilt = fixture.runtime();
    try {
      await expect(
        rebuilt.createPort(fixture.execution).authorize(fixture.request())
      ).rejects.toMatchObject({ code: 'outcome-unknown' });
      expect(fixture.refresh).toHaveBeenCalledOnce();
    } finally {
      await rebuilt.close();
    }
  } finally {
    await fixture.close();
  }
});

it.each(['subject-a', undefined])(
  'preserves the proven subject through refresh reporting %s',
  async (subject) => {
    const fixture = await setup('oauth');
    fixture.refresh.mockResolvedValue({
      accessToken: 'refreshed-a',
      refreshToken: 'rotated-a',
      expiresAt: 5000,
      ...(subject ? { subject } : {}),
    });
    try {
      await fixture.seed({
        accessToken: 'expired-a',
        refreshToken: 'refresh-a',
        expiresAt: 1,
        subject: 'subject-a',
      });
      expect(
        await fixture.host.createPort(fixture.execution).authorize(fixture.request())
      ).toMatchObject({ token: 'refreshed-a' });
      expect((await fixture.store.read(fixture.account))?.payload).toMatchObject({
        status: 'ready',
        subject: 'subject-a',
      });
      expect(fixture.refresh).toHaveBeenCalledOnce();
    } finally {
      await fixture.close();
    }
  }
);
it.each([
  { code: 'not-submitted', credentialInvalid: false, expected: 'not-submitted' },
  { code: 'rejected', credentialInvalid: false, expected: 'rejected' },
  { code: 'rejected', credentialInvalid: true, expected: 'reauthorize' },
])('preserves the meaning of a $code refresh result with credentialInvalid=$credentialInvalid', async failure => {
  const fixture = await setup('oauth');
  fixture.refresh.mockRejectedValue(Object.assign(new Error('synthetic OAuth failure'), failure));
  try {
    await fixture.seed({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1 });
    await expect(fixture.host.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: failure.expected });
    expect(await fixture.host.status(fixture.account)).toEqual({ status: failure.credentialInvalid ? 'reauthorize' : 'ready', revision: 3 });
    if (!failure.credentialInvalid) expect((await fixture.store.read(fixture.account))?.payload)
      .toEqual({ status: 'ready', method: 'oauth', credential: { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1 } });
    expect(fixture.refresh).toHaveBeenCalledOnce();
  } finally { await fixture.close(); }
});

it('keeps a single pending login per account, releases it on cancel and refuses its consumed nonce', async () => {
  const fixture = await setup('oauth');
  try {
    const input = { account: fixture.account, signal: new AbortController().signal };
    const [first, second] = await Promise.all([fixture.host.beginLogin(input), fixture.host.beginLogin(input)]);
    expect(first).toEqual(second);
    expect(fixture.release).not.toHaveBeenCalled();
    await fixture.host.cancelLogin({ account: fixture.account, loginId: first.loginId });
    expect(fixture.release).toHaveBeenCalledOnce();
    await expect(fixture.host.completeLogin({ account: fixture.account, ...first, code: 'obsolete', signal: input.signal }))
      .rejects.toMatchObject({ code: 'not-authorized' });
    const third = await fixture.host.beginLogin(input);
    expect(third.loginId).not.toBe(first.loginId);
    await fixture.host.cancelLogin({ account: fixture.account, loginId: third.loginId });
    expect(fixture.release).toHaveBeenCalledTimes(2);
  } finally { await fixture.close(); }
});

it('records a disconnect version even before the first login has any credential, rejecting a late callback without exchanging', async () => {
  const fixture = await setup('oauth');
  try {
    const login = await fixture.host.beginLogin({ account: fixture.account, signal: new AbortController().signal });
    expect(JSON.stringify(login)).not.toContain('private-verifier');
    await fixture.host.disconnect({ account: fixture.account, expectedRevision: 0, authContractVersion: '1' });
    expect(await fixture.host.status(fixture.account)).toEqual({ status: 'disconnected', revision: 1 });
    await expect(fixture.host.completeLogin({ account: fixture.account, ...login, code: 'late-code', signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'not-authorized' });
    expect(fixture.complete).not.toHaveBeenCalled();
    await expect(fixture.host.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'disconnected' });
  } finally { await fixture.close(); }
});

it('cannot publish a late exchange over a disconnected account, even if a provider ignores cancellation', async () => {
  const fixture = await setup('oauth');
  const entered = deferred<void>(), result = deferred<OAuthCredential>();
  fixture.complete.mockImplementation(async () => { entered.resolve(); return result.promise; });
  try {
    const login = await fixture.host.beginLogin({ account: fixture.account, signal: new AbortController().signal });
    const completion = fixture.host.completeLogin({ account: fixture.account, ...login, code: 'synthetic-code', signal: new AbortController().signal });
    // Cancellation after submission is an unknown remote outcome, not a fresh code exchange or a failed submission.
    const rejected = expect(completion).rejects.toMatchObject({ code: 'outcome-unknown' });
    await entered.promise;
    await fixture.host.disconnect({ account: fixture.account, expectedRevision: 1, authContractVersion: '1' });
    result.resolve({ accessToken: 'must-not-publish', refreshToken: 'must-not-publish-refresh' });
    await rejected;
    expect(await fixture.host.status(fixture.account)).toEqual({ status: 'disconnected', revision: 2 });
    await expect(fixture.host.createPort(fixture.execution).authorize(fixture.request())).rejects.toMatchObject({ code: 'disconnected' });
  } finally { await fixture.close(); }
});
