import { antigravityOAuth, codexOAuth, ProviderAuthenticationError } from '../../src/providers/oauth.js';
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
