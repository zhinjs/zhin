import { describe, expect, it, vi } from 'vitest';
import { createPersonalModelFetch, type PersonalModelTransport } from '../../../src/plugin-runtime/personal-models/network.js';

// Exercise the actual shared URL/IP rules without loading the unrelated unbuilt Agent barrel.
vi.mock('@zhin.js/agent/security', async () => import('../../../../../packages/im/agent/src/security/network-policy.js'));

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const baseUrl = 'https://provider.example/v1';

describe('personal model HTTPS fetch authority', () => {
  it('retains SDK POST, headers and streaming SSE while pinning the verified public address', async () => {
    let finish: (() => void) | undefined;
    const transport = vi.fn<PersonalModelTransport>(async ({ request }) => {
      expect(request.method).toBe('POST');
      expect(request.headers.get('authorization')).toBe('Bearer synthetic-key');
      expect(await request.text()).toBe('{"model":"synthetic"}');
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: first\n\n'));
          finish = () => { controller.enqueue(new TextEncoder().encode('data: last\n\n')); controller.close(); };
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const response = await createPersonalModelFetch({ baseUrl, lookup: publicDns, transport })(baseUrl + '/chat/completions', {
      method: 'POST', headers: { authorization: 'Bearer synthetic-key' }, body: '{"model":"synthetic"}',
    });
    expect(transport.mock.calls[0][0].address).toEqual({ address: '93.184.216.34', family: 4 });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n');
    finish!();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: last\n\n');
  });

  it.each([
    'http://provider.example/v1', 'https://localhost/v1', 'https://127.0.0.1/v1',
    'https://[::ffff:7f00:1]/v1', 'https://user:synthetic-key@provider.example/v1', 'not a url',
  ])('rejects disallowed base URL without exposing it: %s', value => {
    expect(() => createPersonalModelFetch({ baseUrl: value })).toThrow();
    try { createPersonalModelFetch({ baseUrl: value }); } catch (error) { expect(String(error)).not.toContain('synthetic-key'); }
  });

  it.each([
    'key', 'api_key', 'apiKey', 'API-KEY', 'x-api-key', 'access_token', 'token', 'auth', 'authorization',
    'password', 'client_secret', 'refresh_token', 'api_secret', 'access_key', 'secret_access_key',
    'credential', 'signature', 'sig', 'oauth_token', 'X-Amz-Credential', 'X-Goog-Signature', '%61pi%5fkey',
  ])('rejects authentication in persisted base URL query without echoing it: %s', name => {
    let failure: unknown;
    try { createPersonalModelFetch({ baseUrl: `${baseUrl}?region=ap&${name}=synthetic-url-secret` }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'invalid_url' });
    expect(String(failure)).not.toContain('synthetic-url-secret');
  });

  it('keeps OAuth-style authentication fragments out of persisted URL metadata', () => {
    expect(() => createPersonalModelFetch({ baseUrl: `${baseUrl}#access_token=synthetic-url-secret` })).toThrow('Invalid personal model URL');
  });

  it('preserves ordinary base URL queries and permits SDK-added authentication only on execution URLs', async () => {
    const transport = vi.fn<PersonalModelTransport>(async ({ request }) => {
      expect(new URL(request.url).searchParams.get('key')).toBe('synthetic-runtime-secret');
      return new Response('ok');
    });
    const base = `${baseUrl}?region=ap&api-version=2026-10&max_tokens=12`;
    const fetch = createPersonalModelFetch({ baseUrl: base, lookup: publicDns, transport });
    expect(await (await fetch(`${baseUrl}/models?region=ap&api-version=2026-10&key=synthetic-runtime-secret`)).text()).toBe('ok');
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    [{ address: '127.0.0.1', family: 4 }], [{ address: '10.0.0.1', family: 4 }],
    [{ address: '::ffff:7f00:1', family: 6 }], [{ address: 'fe80::1', family: 6 }],
    [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }],
    [{ address: 'invalid address', family: 4 }], [{ address: '93.184.216.34', family: 6 }], [],
  ].map(addresses => ({ addresses })))('rejects every non-public or malformed DNS answer before transport: %j', async ({ addresses }) => {
    const transport = vi.fn<PersonalModelTransport>();
    const fetch = createPersonalModelFetch({ baseUrl, lookup: async () => addresses, transport });
    await expect(fetch(baseUrl)).rejects.toMatchObject({ code: addresses.length ? 'denied' : 'dns' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('reauthorizes and resolves every same-origin redirect rather than trusting the first lookup', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(await publicDns()).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const transport = vi.fn<PersonalModelTransport>().mockResolvedValue(new Response(null, { status: 307, headers: { location: '/v1/next' } }));
    const fetch = createPersonalModelFetch({ baseUrl, lookup, transport });
    await expect(fetch(baseUrl, { method: 'POST', body: 'synthetic-body' })).rejects.toMatchObject({ code: 'denied' });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('replays exact POST bytes on 307 and uses Fetch GET semantics for 303', async () => {
    const requests: Array<{ method: string; text: string; type: string | null }> = [];
    const transport: PersonalModelTransport = async ({ request }) => {
      requests.push({ method: request.method, text: await request.text(), type: request.headers.get('content-type') });
      return requests.length === 1 ? new Response(null, { status: 307, headers: { location: '/second' } })
        : requests.length === 2 ? new Response(null, { status: 303, headers: { location: '/third' } }) : new Response('ok');
    };
    const fetch = createPersonalModelFetch({ baseUrl, lookup: publicDns, transport });
    expect(await (await fetch(baseUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'synthetic-body' })).text()).toBe('ok');
    expect(requests).toEqual([
      { method: 'POST', text: 'synthetic-body', type: 'application/json' },
      { method: 'POST', text: 'synthetic-body', type: 'application/json' },
      { method: 'GET', text: '', type: null },
    ]);
  });

  it('never forwards credentials to a cross-origin URL or insecure redirect', async () => {
    for (const location of ['https://other.example/path', 'http://provider.example/path', 'https://u:synthetic-key@provider.example/path']) {
      const transport = vi.fn<PersonalModelTransport>().mockResolvedValue(new Response(null, { status: 307, headers: { location } }));
      const fetch = createPersonalModelFetch({ baseUrl, lookup: publicDns, transport });
      await expect(fetch(baseUrl, { method: 'POST', headers: { authorization: 'Bearer synthetic-key', 'x-api-key': 'synthetic-key' }, body: 'payload' })).rejects.toMatchObject({ code: 'redirect' });
      expect(transport).toHaveBeenCalledTimes(1);
    }
    const transport = vi.fn<PersonalModelTransport>();
    await expect(createPersonalModelFetch({ baseUrl, lookup: publicDns, transport })('https://other.example/')).rejects.toMatchObject({ code: 'denied' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('cancels promptly while DNS is unresolved without starting transport', async () => {
    const controller = new AbortController();
    const transport = vi.fn<PersonalModelTransport>();
    const fetch = createPersonalModelFetch({ baseUrl, lookup: async () => new Promise(() => {}), transport });
    const pending = fetch(baseUrl, { signal: controller.signal });
    const reason = new DOMException('Cancelled', 'AbortError');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(transport).not.toHaveBeenCalled();
  });

  it('preserves caller cancellation and redacts transport failures containing credential URLs', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Cancelled', 'AbortError');
    const transport: PersonalModelTransport = async ({ request }) => {
      controller.abort(reason);
      request.signal.throwIfAborted();
      return new Response();
    };
    const fetch = createPersonalModelFetch({ baseUrl, lookup: publicDns, transport });
    await expect(fetch(baseUrl, { signal: controller.signal })).rejects.toBe(reason);
    const broken = createPersonalModelFetch({ baseUrl, lookup: publicDns, transport: async () => { throw new Error('https://provider.example/?key=synthetic-key'); } });
    const error = await broken(baseUrl).catch(value => value);
    expect(error.code).toBe('transport');
    expect(String(error)).not.toContain('synthetic-key');
    expect(error.cause).toBeUndefined();
  });
});
