import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, BlockedUrlError, fetchPublic, isPublicAddress, readCappedBody } from '../src/public-fetch.js';

const publicLookup = async () => ['93.184.216.34'];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public-fetch address policy', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '100.100.100.200', '168.63.129.16', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', 'ff02::1', '2001:db8::1', '2002:7f00:1::',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'not-an-ip',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('accepts %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    'ftp://example.com/x', 'file:///etc/passwd', 'not a url', 'https://user:pass@example.com/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://[::ffff:7f00:1]/',
    'http://localhost/', 'http://intranet/', 'http://db.internal/', 'http://printer.local/',
    'http://metadata.google.internal/',
  ])('refuses %s without resolving', async (url) => {
    const lookup = vi.fn(publicLookup);
    await expect(assertPublicUrl(url, lookup)).rejects.toBeInstanceOf(BlockedUrlError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a public name when any resolved address is internal, and fails closed on lookup errors', async () => {
    await expect(assertPublicUrl('https://rebind.example.org/', async () => ['93.184.216.34', '10.0.0.5']))
      .rejects.toThrow(/non-public/);
    await expect(assertPublicUrl('https://gone.example.org/', async () => [])).rejects.toThrow(/resolved/);
    await expect(assertPublicUrl('https://gone.example.org/', async () => { throw new Error('ENOTFOUND'); }))
      .rejects.toThrow(/resolved/);
    expect((await assertPublicUrl('https://example.org/a?b=1', publicLookup)).href).toBe('https://example.org/a?b=1');
  });
});

describe('fetchPublic', () => {
  it('checks every redirect hop and never requests an internal target', async () => {
    const cancel = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => ({
      status: 302, headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }), body: { cancel },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPublic('https://short.example.org/x', { lookup: publicLookup })).rejects.toBeInstanceOf(BlockedUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('follows public redirects, reports the final URL and always sends a timeout signal', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/x')
      ? new Response(null, { status: 301, headers: { location: '/final' } })
      : new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchPublic('https://short.example.org/x', { lookup: publicLookup });
    expect(result.url).toBe('https://short.example.org/final');
    expect(await result.response.text()).toBe('ok');
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('stops after maxRedirects and applies the caller allow-list per hop', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } })));
    await expect(fetchPublic('https://loop.example.org/', { lookup: publicLookup, maxRedirects: 2 }))
      .rejects.toThrow(/too many redirects/);
    await expect(fetchPublic('https://loop.example.org/', { lookup: publicLookup, allow: () => false }))
      .rejects.toThrow(/allow-list/);
  });

  it('aborts a hanging request at the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })));
    await expect(fetchPublic('https://slow.example.org/', { lookup: publicLookup, timeoutMs: 20 }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('readCappedBody', () => {
  it('returns the body under the cap and drops larger bodies', async () => {
    expect((await readCappedBody(new Response('hello'), 10))?.toString()).toBe('hello');
    expect(await readCappedBody(new Response('x'.repeat(64)), 10)).toBeUndefined();
    expect(await readCappedBody(new Response('x', { headers: { 'content-length': '999' } }), 10)).toBeUndefined();
  });
});
