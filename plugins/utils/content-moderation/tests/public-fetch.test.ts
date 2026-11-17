import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  assertPublicUrl,
  BlockedUrlError,
  fetchPublic,
  type HostLookup,
  isPublicAddress,
  type PinnedRequest,
  readCappedBody,
  requestPinned,
} from '../src/public-fetch.js';

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

type RequestArgs = Parameters<PinnedRequest>;

function pinned(handler: (url: URL, address: string | undefined, init: RequestArgs[2], signal: AbortSignal) => Response | Promise<Response>) {
  return vi.fn<PinnedRequest>(async (url, address, init, signal) => handler(url, address, init, signal));
}

describe('fetchPublic', () => {
  it('checks every redirect hop and never requests an internal target', async () => {
    const cancel = vi.fn(async () => undefined);
    const request = pinned(() => ({
      status: 302, headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }), body: { cancel },
    }) as unknown as Response);
    await expect(fetchPublic('https://short.example.org/x', { lookup: publicLookup, request })).rejects.toBeInstanceOf(BlockedUrlError);
    expect(request).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('connects to the address it checked: one lookup per hop, no second resolution (DNS rebinding)', async () => {
    const lookup = vi.fn<HostLookup>()
      .mockResolvedValueOnce(['93.184.216.34'])
      // A rebinding resolver would answer a second query with an internal address.
      .mockResolvedValue(['127.0.0.1']);
    const request = pinned(() => new Response('ok'));
    const result = await fetchPublic('https://rebind.example.org/a', { lookup, request });
    expect(await result.response.text()).toBe('ok');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]).toBe('93.184.216.34');
    expect(request.mock.calls[0]![0].href).toBe('https://rebind.example.org/a');
  });

  it('follows public redirects, reports the final URL and always sends a timeout signal', async () => {
    const request = pinned((url) => url.pathname === '/x'
      ? new Response(null, { status: 301, headers: { location: '/final' } })
      : new Response('ok'));
    const result = await fetchPublic('https://short.example.org/x', { lookup: publicLookup, request });
    expect(result.url).toBe('https://short.example.org/final');
    expect(await result.response.text()).toBe('ok');
    for (const [, address, , signal] of request.mock.calls) {
      expect(address).toBe('93.184.216.34');
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('drops credentials on a cross-origin redirect and keeps them on the same origin', async () => {
    const request = pinned((url) => url.pathname === '/a'
      ? new Response(null, { status: 302, headers: { location: '/b' } })
      : url.pathname === '/b'
        ? new Response(null, { status: 302, headers: { location: 'https://other.example.org/c' } })
        : new Response('ok'));
    await fetchPublic('https://short.example.org/a', {
      lookup: publicLookup,
      request,
      init: { headers: { Authorization: 'Bearer secret', Cookie: 'sid=1', 'User-Agent': 'zhin' } },
    });
    const seen = request.mock.calls.map(([url, , init]) => [url.pathname, init.headers.get('authorization'), init.headers.get('cookie'), init.headers.get('user-agent')]);
    expect(seen).toEqual([
      ['/a', 'Bearer secret', 'sid=1', 'zhin'],
      ['/b', 'Bearer secret', 'sid=1', 'zhin'],
      ['/c', null, null, 'zhin'],
    ]);
  });

  it('stops after maxRedirects and applies the caller allow-list per hop', async () => {
    const request = pinned(() => new Response(null, { status: 302, headers: { location: '/again' } }));
    await expect(fetchPublic('https://loop.example.org/', { lookup: publicLookup, maxRedirects: 2, request }))
      .rejects.toThrow(/too many redirects/);
    expect(request).toHaveBeenCalledTimes(3);
    await expect(fetchPublic('https://loop.example.org/', { lookup: publicLookup, allow: () => false, request }))
      .rejects.toThrow(/allow-list/);
  });

  it('aborts a hanging request at the timeout', async () => {
    const request = vi.fn<PinnedRequest>((_url, _address, _init, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    await expect(fetchPublic('https://slow.example.org/', { lookup: publicLookup, timeoutMs: 20, request }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('only sends GET or HEAD', async () => {
    await expect(fetchPublic('https://example.org/', { lookup: publicLookup, init: { method: 'POST' }, request: pinned(() => new Response('')) }))
      .rejects.toBeInstanceOf(TypeError);
  });
});

describe('requestPinned (real socket)', () => {
  let server: Server;
  let port: number;
  const seenHosts: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seenHosts.push(req.headers.host ?? '');
      if (req.url === '/bomb') {
        res.writeHead(200, { 'content-encoding': 'gzip' });
        res.end(gzipSync(Buffer.alloc(8 * 1024 * 1024)));
        return;
      }
      if (req.url === '/drip') {
        res.writeHead(200);
        const timer = setInterval(() => res.write('x'), 20);
        res.on('close', () => clearInterval(timer));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('pinned');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const get = (path: string, signal = AbortSignal.timeout(5_000)) =>
    requestPinned(new URL(`http://feed.example.org:${port}${path}`), '127.0.0.1', { method: 'GET', headers: new Headers() }, signal);

  it('connects to the given address without resolving the name and keeps the Host header', async () => {
    const response = await get('/');
    expect(await response.text()).toBe('pinned');
    expect(seenHosts.at(-1)).toBe(`feed.example.org:${port}`);
  });

  it('caps the decoded size of a compressed body (decompression bomb)', async () => {
    const response = await get('/bomb');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await readCappedBody(response, 64 * 1024)).toBeUndefined();
  });

  it('the timeout also ends a body that trickles in', async () => {
    const response = await get('/drip', AbortSignal.timeout(200));
    await expect(readCappedBody(response, 1024 * 1024)).rejects.toBeDefined();
  });
});

describe('readCappedBody', () => {
  it('returns the body under the cap and drops larger bodies', async () => {
    expect((await readCappedBody(new Response('hello'), 10))?.toString()).toBe('hello');
    expect(await readCappedBody(new Response('x'.repeat(64)), 10)).toBeUndefined();
    expect(await readCappedBody(new Response('x', { headers: { 'content-length': '999' } }), 10)).toBeUndefined();
  });
});
