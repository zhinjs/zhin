import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhClient, type GhDeviceFlowPollResult } from '../src/gh-client.js';
import { executeGithubBind } from '../agents/github/skills/github-account/handlers.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('GhClient.deviceFlowPollToken', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function poll(overrides: Partial<Parameters<typeof GhClient.deviceFlowPollToken>[0]> = {}) {
    return GhClient.deviceFlowPollToken({ clientId: 'client', deviceCode: 'device', interval: 5, expiresIn: 60, ...overrides });
  }

  it('keeps polling through pending, network failures and non-JSON responses, then returns the token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_token', token_type: 'bearer', scope: 'repo' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = poll();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toEqual({ status: 'authorized', access_token: 'gho_token', token_type: 'bearer', scope: 'repo' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    // Every request carries a timeout signal.
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('honours slow_down by lengthening the interval', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down', interval: 12 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 't' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = poll();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toMatchObject({ status: 'authorized', access_token: 't' });
  });

  it('distinguishes denial, an expired code and other OAuth errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'access_denied' })));
    let result = poll();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({ status: 'denied' });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'expired_token' })));
    result = poll();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({ status: 'expired' });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'incorrect_client_credentials', error_description: 'bad client' })));
    result = poll();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({ status: 'error', error: 'bad client' });
  });

  it('gives up with "expired" at the deadline even when every request fails', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    vi.stubGlobal('fetch', fetchMock);
    const result = poll({ expiresIn: 12 });
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(result).resolves.toEqual({ status: 'expired' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops immediately when the lifecycle signal aborts, without another request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'authorization_pending' }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const result = poll({ signal: controller.signal, expiresIn: 900 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(result).resolves.toEqual({ status: 'aborted' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports "aborted" when the signal fires while a request is in flight', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const result = poll({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(5_000);
    controller.abort();
    await expect(result).resolves.toEqual({ status: 'aborted' });
  });
});

describe('executeGithubBind device flow outcomes', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(sender: string) {
    let finish!: (result: GhDeviceFlowPollResult) => void;
    vi.spyOn(GhClient, 'deviceFlowRequestCode').mockResolvedValue({ device_code: 'd', user_code: 'CODE', verification_uri: 'https://github.example.test/device', interval: 5, expires_in: 600 });
    const pollToken = vi.spyOn(GhClient, 'deviceFlowPollToken').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const insert = vi.fn(async () => undefined);
    const model = { select: () => ({ where: async () => [] }), insert };
    const controller = new AbortController();
    const client = { clientId: 'client', host: 'github.example.test', lifecycleSignal: controller.signal, database: { models: new Map([['github_oauth_users', model]]) } };
    const message = { clientAdapter: 'github', sender: { id: sender }, locale: 'en', $reply: vi.fn(async () => undefined) };
    return { finish: (result: GhDeviceFlowPollResult) => finish(result), pollToken, insert, client, message, controller };
  }

  it('passes the endpoint lifecycle signal to the poll', async () => {
    const ctx = setup('signal-user');
    await executeGithubBind({}, ctx.client as never, ctx.message as never, 'en');
    expect(ctx.pollToken).toHaveBeenCalledWith(expect.objectContaining({ deviceCode: 'd', interval: 5, expiresIn: 600, signal: ctx.controller.signal }));
    ctx.finish({ status: 'aborted' });
    await vi.waitFor(async () => expect(await executeGithubBind({}, ctx.client as never, ctx.message as never, 'en')).toContain('CODE'));
    expect(ctx.message.$reply).not.toHaveBeenCalled();
    ctx.finish({ status: 'aborted' });
  });

  it.each([
    [{ status: 'expired' }, '⌛ GitHub authorization timed out; no account was linked. Start account linking again.'],
    [{ status: 'denied' }, '🚫 GitHub authorization was denied; no account was linked.'],
    [{ status: 'error', error: 'bad client' }, '❌ GitHub account linking failed: bad client'],
  ] as const)('tells the user when the flow ends with %o', async (outcome, text) => {
    const ctx = setup(`outcome-${outcome.status}`);
    await executeGithubBind({}, ctx.client as never, ctx.message as never, 'en');
    ctx.finish(outcome);
    await vi.waitFor(() => expect(ctx.message.$reply).toHaveBeenCalledWith(text));
    expect(ctx.insert).not.toHaveBeenCalled();
  });

  it('does not store a binding when the granted token cannot be verified', async () => {
    const ctx = setup('unverified-user');
    vi.spyOn(GhClient.prototype, 'verifyAuth').mockResolvedValue({ ok: false, user: '', message: 'bad credentials' });
    await executeGithubBind({}, ctx.client as never, ctx.message as never, 'en');
    ctx.finish({ status: 'authorized', access_token: 'tok', token_type: 'bearer', scope: '' });
    await vi.waitFor(() => expect(ctx.message.$reply).toHaveBeenCalledWith(
      '❌ Authorization succeeded, but the GitHub account could not be verified; no account was linked. Start account linking again.',
    ));
    expect(ctx.insert).not.toHaveBeenCalled();
  });

  it('refuses a second concurrent flow for the same user and allows one again afterwards', async () => {
    const ctx = setup('concurrent-user');
    expect(await executeGithubBind({}, ctx.client as never, ctx.message as never, 'en')).toContain('CODE');
    expect(await executeGithubBind({}, ctx.client as never, ctx.message as never, 'en'))
      .toBe('⏳ A GitHub account link is already waiting for authorization. Finish it or wait for it to expire.');
    expect(ctx.pollToken).toHaveBeenCalledTimes(1);
    // Another user is not blocked.
    const other = { ...ctx.message, sender: { id: 'concurrent-other' }, $reply: vi.fn(async () => undefined) };
    expect(await executeGithubBind({}, ctx.client as never, other as never, 'en')).toContain('CODE');
    ctx.finish({ status: 'denied' });
    ctx.finish({ status: 'denied' });
    await vi.waitFor(() => expect(other.$reply).toHaveBeenCalled());
  });

  it('releases the per-user guard when the device code request itself fails', async () => {
    const ctx = setup('request-fail-user');
    vi.spyOn(GhClient, 'deviceFlowRequestCode').mockRejectedValueOnce(new Error('offline'));
    expect(await executeGithubBind({}, ctx.client as never, ctx.message as never, 'en')).toBe('❌ Could not start Device Flow: offline');
    expect(await executeGithubBind({}, ctx.client as never, ctx.message as never, 'en')).toContain('CODE');
    ctx.finish({ status: 'aborted' });
  });
});
