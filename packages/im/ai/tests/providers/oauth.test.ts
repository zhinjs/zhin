import { antigravityOAuth, codexOAuth, createAntigravityOAuth, ProviderAuthenticationError, ProviderPreparationError } from '../../src/providers/oauth.js';
import type { StandardServiceOptions } from '../../src/providers/schema.js';
import type { ProviderService } from '../../src/provider/types.js';

const service: ProviderService<StandardServiceOptions> = {
  id: 'service', rootId: 'host', ownerId: 'host', revision: 1,
  driver: { id: 'codex-subscription', owner: 'root/codex', contractVersion: '1' },
  options: { baseUrl: 'https://chatgpt.com/backend-api/codex' }, models: {},
};
const signal = new AbortController().signal;
const redirectUri = 'http://localhost:1455/auth/callback';

it('creates a PKCE challenge without a network request and binds the callback state and URI', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const challenge = await codexOAuth.begin({ service, fetch, signal, redirectUri });
  const url = new URL(challenge.authorizationUrl);
  expect(url.origin).toBe('https://auth.openai.com');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('state')).toBe(challenge.state);
  expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
  await expect(codexOAuth.complete({ service, fetch, signal, redirectUri, code: 'synthetic', state: 'different', challenge }))
    .rejects.toMatchObject({ code: 'not-submitted', credentialInvalid: false });
  expect(fetch).not.toHaveBeenCalled();
});

it('exchanges a code once, preserves rotated credentials and keeps routing hints separate from verified identity', async () => {
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'routing-account' } })).toString('base64url');
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
    access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600,
    id_token: `synthetic.${payload}.unverified`,
  }));
  const challenge = await codexOAuth.begin({ service, fetch, signal, redirectUri });
  const credential = await codexOAuth.complete({ service, fetch, signal, redirectUri, code: 'synthetic-code', state: challenge.state, challenge });
  expect(credential.subject).toBeUndefined();
  expect(credential.metadata?.chatgptAccountId).toBe('routing-account');
  expect(credential.refreshToken).toBe('synthetic-refresh');
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = new URLSearchParams(String(fetch.mock.calls[0]![1]?.body));
  expect(body.get('code_verifier')).toBe(challenge.privateState.verifier);
  fetch.mockResolvedValueOnce(Response.json({ access_token: 'rotated-access', expires_in: 3600 }));
  const rotated = await codexOAuth.refresh({ service, fetch, signal, credential });
  expect(rotated.refreshToken).toBe('synthetic-refresh');
  expect(rotated.metadata?.chatgptAccountId).toBe('routing-account');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
  { status: 400, error: 'invalid_grant', invalid: true },
  { status: 401, error: 'invalid_token', invalid: true },
  { status: 400, error: 'invalid_client', invalid: false },
  { status: 429, error: 'temporarily_unavailable', invalid: false },
  { status: 429, error: 'invalid_grant', invalid: false },
])('separates HTTP $status $error from proof of invalid credentials', async ({ status, error, invalid }) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ error, error_description: 'PRIVATE BODY MUST NOT ESCAPE' }, { status }));
  let failure: unknown;
  try {
    await codexOAuth.refresh({ service, fetch, signal, credential: { accessToken: 'old', refreshToken: 'refresh' } });
  } catch (value) { failure = value; }
  expect(failure).toBeInstanceOf(ProviderAuthenticationError);
  expect(failure).toMatchObject({ code: 'rejected', oauthError: error, credentialInvalid: invalid });
  expect(String(failure)).not.toContain('PRIVATE');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  { header: '120', delay: 120_000 },
  { header: 'Thu, 01 Jan 1970 00:02:01 GMT', delay: 120_000 },
  { header: 'not-a-delay', delay: undefined },
])('preserves only normalized Retry-After=$header facts from a token rejection', async ({ header, delay }) => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ error: 'slow_down', error_description: 'PRIVATE' },
    { status: 429, headers: { 'retry-after': header, 'x-private': 'PRIVATE' } }));
  try {
    await expect(codexOAuth.refresh({ service, fetch, signal, credential: { accessToken: 'old', refreshToken: 'refresh' } }))
      .rejects.toMatchObject({ code: 'rejected', status: 429, oauthError: 'slow_down', retryAfterMs: delay });
    expect(fetch).toHaveBeenCalledOnce();
  } finally { clock.mockRestore(); }
});

it.each(['required', 'ready'] as const)('preserves account preparation=$value across Antigravity refresh', async status => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ access_token: 'rotated-access', expires_in: 3600 }));
  const credential = { accessToken: 'old', refreshToken: 'synthetic-refresh', subject: 'verified-by-userinfo',
    preparation: { status }, metadata: { projectId: 'actual-project' } };
  const result = await antigravityOAuth.refresh({ service, signal, fetch, client: { clientSecret: 'synthetic-client-secret' }, credential });
  expect(result.preparation).toEqual({ status }); expect(result.subject).toBe(credential.subject); expect(result.metadata?.projectId).toBe('actual-project');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not call an aborted operation or replay a token exchange whose result is unknown', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const credential = { accessToken: 'old', refreshToken: 'refresh' };
  await expect(codexOAuth.refresh({ service, fetch, signal: controller.signal, credential })).rejects.toMatchObject({ code: 'not-submitted' });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRejectedValueOnce(new TypeError('synthetic connection lost after submission'));
  await expect(codexOAuth.refresh({ service, fetch, signal, credential })).rejects.toMatchObject({ code: 'outcome-unknown', credentialInvalid: false });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  () => new Response('not-json', { status: 200 }),
  () => Response.json({ expires_in: 3600 }),
])('does not report malformed successful responses as a completed refresh', async response => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
  await expect(codexOAuth.refresh({ service, fetch, signal, credential: { accessToken: 'old', refreshToken: 'refresh' } })).rejects.toBeInstanceOf(ProviderAuthenticationError);
  expect(fetch).toHaveBeenCalledTimes(1);
});

describe('Antigravity Code Assist preparation', () => {
  const antigravityService = { ...service, driver: { id: 'antigravity', owner: 'root/providers', contractVersion: '1' } } as ProviderService<StandardServiceOptions>;
  const client = { clientSecret: 'synthetic-client-secret' };
  const credential = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', preparation: { status: 'required' as const } };
  const bodies = (fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>) => fetch.mock.calls.map(([url, init]) => ({
    url: String(url), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined,
  }));

  it('sends client metadata to loadCodeAssist and uses a returned project without onboarding', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ currentTier: { id: 'free-tier' }, cloudaicompanionProject: 'managed-project' }));
    const ready = await antigravityOAuth.prepare!({ service: antigravityService, signal, fetch, client, credential });
    expect(ready).toMatchObject({ subject: 'google-subject', preparation: { status: 'ready' }, metadata: { projectId: 'managed-project' } });
    const calls = bodies(fetch);
    expect(calls[1]).toEqual({ url: 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', method: 'POST',
      body: { metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } } });
    expect(calls.some(call => call.url.includes('onboardUser'))).toBe(false);
  });

  it('onboards the default tier when no project exists and polls the long-running operation', async () => {
    const oauth = createAntigravityOAuth({ pollIntervalMs: 0, maxPollAttempts: 3 });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'standard-tier' }, { id: 'free-tier', isDefault: true }] }))
      .mockResolvedValueOnce(Response.json({ name: 'operations/onboard-1', done: false }))
      .mockResolvedValueOnce(Response.json({ name: 'operations/onboard-1', done: false }))
      .mockResolvedValueOnce(Response.json({ name: 'operations/onboard-1', done: true, response: { cloudaicompanionProject: { id: 'onboarded-project' } } }));
    const ready = await oauth.prepare!({ service: antigravityService, signal, fetch, client, credential });
    expect(ready.metadata?.projectId).toBe('onboarded-project');
    const calls = bodies(fetch);
    expect(calls[2]).toEqual({ url: 'https://cloudcode-pa.googleapis.com/v1internal:onboardUser', method: 'POST',
      body: { tierId: 'free-tier', metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } } });
    expect(calls.slice(3).map(call => `${call.method} ${call.url}`)).toEqual([
      'GET https://cloudcode-pa.googleapis.com/v1internal/operations/onboard-1',
      'GET https://cloudcode-pa.googleapis.com/v1internal/operations/onboard-1',
    ]);
  });

  it('bounds onboarding polling', async () => {
    const oauth = createAntigravityOAuth({ pollIntervalMs: 0, maxPollAttempts: 2 });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }))
      .mockImplementation(async () => Response.json({ done: false }));
    await expect(oauth.prepare!({ service: antigravityService, signal, fetch, client, credential }))
      .rejects.toMatchObject({ code: 'project-unavailable', reason: 'onboarding-timeout', step: 'onboard-operation' });
    // One onboardUser call plus two bounded re-submissions (no operation name was returned).
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('surfaces the upstream HTTP status and reason of a failed onboarding without the message body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }))
      .mockResolvedValueOnce(Response.json({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'PRIVATE user@example.com',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }] } }, { status: 403 }));
    let failure: unknown;
    try { await antigravityOAuth.prepare!({ service: antigravityService, signal, fetch, client, credential }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ProviderPreparationError);
    expect(failure).toMatchObject({ code: 'project-unavailable', status: 403, reason: 'SERVICE_DISABLED', step: 'onboard-user' });
    expect(JSON.stringify(failure)).not.toContain('PRIVATE');
    expect(String((failure as Error).message)).not.toContain('PRIVATE');
  });

  it('reports a failed long-running operation and an ineligible account', async () => {
    const oauth = createAntigravityOAuth({ pollIntervalMs: 0 });
    const failedOperation = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }))
      .mockResolvedValueOnce(Response.json({ name: 'operations/x', done: true, error: { code: 9, status: 'FAILED_PRECONDITION' } }));
    await expect(oauth.prepare!({ service: antigravityService, signal, fetch: failedOperation, client, credential }))
      .rejects.toMatchObject({ code: 'project-unavailable', reason: 'FAILED_PRECONDITION', step: 'onboard-operation' });
    // gemini-cli parity: without an `isDefault` tier the legacy tier is onboarded; no project then reports the ineligibility reason.
    const ineligible = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ ineligibleTiers: [{ reasonCode: 'INELIGIBLE_ACCOUNT', reasonMessage: 'PRIVATE' }] }))
      .mockResolvedValueOnce(Response.json({ done: true, response: {} }));
    let failure: unknown;
    try { await oauth.prepare!({ service: antigravityService, signal, fetch: ineligible, client, credential }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'project-unavailable', status: 200, reason: 'INELIGIBLE_ACCOUNT', step: 'onboard-operation' });
    expect(String((failure as Error).message)).not.toContain('PRIVATE');
    expect(ineligible).toHaveBeenCalledTimes(3);
    expect(bodies(ineligible)[2]).toEqual({ url: 'https://cloudcode-pa.googleapis.com/v1internal:onboardUser', method: 'POST',
      body: { tierId: 'legacy-tier', metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } } });
  });

  it('falls back to the legacy tier like gemini-cli when no tier is marked default', async () => {
    const oauth = createAntigravityOAuth({ pollIntervalMs: 0 });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'standard-tier' }] }))
      .mockResolvedValueOnce(Response.json({ done: true, response: { cloudaicompanionProject: { id: 'legacy-project' } } }));
    expect((await oauth.prepare!({ service: antigravityService, signal, fetch, client, credential })).metadata?.projectId).toBe('legacy-project');
    expect(bodies(fetch)[2]?.body).toMatchObject({ tierId: 'legacy-tier' });
  });

  it('reports a default tier without an id as no-default-tier instead of onboarding', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ isDefault: true }] }));
    await expect(antigravityOAuth.prepare!({ service: antigravityService, signal, fetch, client, credential }))
      .rejects.toMatchObject({ code: 'project-unavailable', status: 200, reason: 'no-default-tier', step: 'load-code-assist' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports VALIDATION_REQUIRED as validation-required without onboarding or leaking the validation URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'free-tier', isDefault: true }], ineligibleTiers: [{
        reasonCode: 'VALIDATION_REQUIRED', reasonMessage: 'PRIVATE', validationUrl: 'https://accounts.example/validate?private-token' }] }));
    let failure: unknown;
    try { await antigravityOAuth.prepare!({ service: antigravityService, signal, fetch, client, credential }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'project-unavailable', status: 200, reason: 'validation-required', step: 'load-code-assist' });
    expect(JSON.stringify(failure)).not.toContain('private-token');
    expect(String((failure as Error).message)).not.toContain('private-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['operations/..', 'operations/.', 'operations/a/../b', 'operations/', 'operations/_'])(
    'never polls an unsafe operation name (%s) and re-submits onboardUser instead', async name => {
      const oauth = createAntigravityOAuth({ pollIntervalMs: 0, maxPollAttempts: 1 });
      const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
        .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }))
        .mockResolvedValueOnce(Response.json({ name, done: false }))
        .mockResolvedValueOnce(Response.json({ done: true, response: { cloudaicompanionProject: 'project' } }));
      expect((await oauth.prepare!({ service: antigravityService, signal, fetch, client, credential })).metadata?.projectId).toBe('project');
      expect(bodies(fetch).map(call => `${call.method} ${call.url}`).slice(2)).toEqual([
        'POST https://cloudcode-pa.googleapis.com/v1internal:onboardUser',
        'POST https://cloudcode-pa.googleapis.com/v1internal:onboardUser',
      ]);
    });

  it('accepts a regular operation name containing dots', async () => {
    const oauth = createAntigravityOAuth({ pollIntervalMs: 0, maxPollAttempts: 1 });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }))
      .mockResolvedValueOnce(Response.json({ name: 'operations/onboard.v1-2', done: false }))
      .mockResolvedValueOnce(Response.json({ done: true, response: { cloudaicompanionProject: 'project' } }));
    await oauth.prepare!({ service: antigravityService, signal, fetch, client, credential });
    expect(String(fetch.mock.calls[3]?.[0])).toBe('https://cloudcode-pa.googleapis.com/v1internal/operations/onboard.v1-2');
  });

  const hanging: typeof globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  });

  it('bounds each upstream request with its own timeout', async () => {
    const oauth = createAntigravityOAuth({ requestTimeoutMs: 20 });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockImplementationOnce(hanging);
    await expect(oauth.prepare!({ service: antigravityService, signal, fetch, client, credential }))
      .rejects.toMatchObject({ code: 'project-unavailable', reason: 'request-timeout', step: 'load-code-assist' });
    const identity = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(hanging);
    await expect(oauth.prepare!({ service: antigravityService, signal, fetch: identity, client, credential }))
      .rejects.toMatchObject({ code: 'identity-unavailable', reason: 'request-timeout', step: 'identity' });
  });

  it('bounds the whole preparation, including onboarding polls, with an overall deadline', async () => {
    const oauth = createAntigravityOAuth({ pollIntervalMs: 10, maxPollAttempts: 10_000, overallTimeoutMs: 80 });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'google-subject' }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }))
      .mockImplementation(async () => Response.json({ name: 'operations/slow', done: false }));
    await expect(oauth.prepare!({ service: antigravityService, signal, fetch, client, credential }))
      .rejects.toMatchObject({ code: 'project-unavailable', reason: 'preparation-timeout' });
    expect(fetch.mock.calls.length).toBeLessThan(100);
  });

  it('propagates the caller abort itself rather than a timeout diagnostic', async () => {
    const controller = new AbortController();
    const reason = new Error('synthetic caller abort');
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce((url, init) => {
      queueMicrotask(() => controller.abort(reason));
      return hanging(url, init);
    });
    await expect(antigravityOAuth.prepare!({ service: antigravityService, signal: controller.signal, fetch, client, credential })).rejects.toBe(reason);
  });

  it('declares that the Antigravity client needs a client secret and refuses to begin without one', async () => {
    expect(antigravityOAuth.requiresClientSecret).toBe(true);
    expect(codexOAuth.requiresClientSecret).toBeUndefined();
    await expect(antigravityOAuth.begin({ service: antigravityService, signal, fetch: vi.fn(), redirectUri: antigravityOAuth.redirectUri }))
      .rejects.toMatchObject({ code: 'not-submitted' });
  });
});
