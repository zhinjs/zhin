import { describe, expect, it, vi } from 'vitest';
import { fetchPublicMediaBytes } from '../src/network/public-media-fetch.js';
import { isDefaultOrAllowedPort } from '../src/network/ssrf.js';
import type { NetworkTransport } from '../src/network/pinned-transport.js';

type Reply = { status: number; headers?: Record<string, string>; body?: Uint8Array };

/** A transport that answers by full URL and records every hop it was asked to connect to. */
function fakeTransport(replies: Record<string, Reply>) {
  const requestBytes = vi.fn(async (url: URL) => {
    const reply = replies[url.href];
    if (!reply) throw new Error(`unexpected request to ${url.host}`);
    return { status: reply.status, statusText: '', headers: reply.headers ?? {}, body: reply.body ?? Uint8Array.of(1, 2, 3) };
  });
  const transport: NetworkTransport = { request: vi.fn(), requestBytes };
  return { transport, requestBytes };
}

describe('fetchPublicMediaBytes — port rule (#1250 第 48 批)', () => {
  it.each([
    ['ssh', 'https://cdn.example:22/a.png'],
    ['alternate https', 'https://cdn.example:8443/a.png'],
    ['port 0', 'https://cdn.example:0/a.png'],
    ['highest port', 'https://cdn.example:65535/a.png'],
    ["http's port on https", 'https://cdn.example:80/a.png'],
  ])('refuses %s with reason port, without connecting', async (_label, url) => {
    const net = fakeTransport({});
    const result = await fetchPublicMediaBytes(url, { maxBytes: 1024, transport: net.transport });
    expect(result).toEqual({ ok: false, code: 'blocked', host: 'cdn.example', reason: 'port' });
    expect(net.requestBytes).not.toHaveBeenCalled();
  });

  it('refuses a non-default http port even with allowHttp', async () => {
    const net = fakeTransport({});
    const result = await fetchPublicMediaBytes('http://cdn.example:8080/a.amr', { maxBytes: 1024, allowHttp: true, transport: net.transport });
    expect(result).toMatchObject({ ok: false, code: 'blocked', reason: 'port' });
    expect(net.requestBytes).not.toHaveBeenCalled();
  });

  it.each([
    ['no port', 'https://cdn.example/a.png', {}],
    ['explicit :443', 'https://cdn.example:443/a.png', {}],
    ['http :80 with allowHttp', 'http://cdn.example:80/a.amr', { allowHttp: true }],
    ['http without port with allowHttp', 'http://cdn.example/a.amr', { allowHttp: true }],
  ])('accepts %s', async (_label, url, extra) => {
    const href = new URL(url).href;
    const net = fakeTransport({ [href]: { status: 200 } });
    const result = await fetchPublicMediaBytes(url, { maxBytes: 1024, transport: net.transport, ...extra });
    expect(result.ok).toBe(true);
    expect(net.requestBytes).toHaveBeenCalledTimes(1);
  });

  it('checks the port on every redirect hop', async () => {
    const net = fakeTransport({
      'https://cdn.example/start': { status: 302, headers: { location: 'https://other.example:22/next' } },
    });
    const result = await fetchPublicMediaBytes('https://cdn.example/start', { maxBytes: 1024, transport: net.transport });
    expect(result).toEqual({ ok: false, code: 'blocked', host: 'other.example', reason: 'port' });
    expect(net.requestBytes).toHaveBeenCalledTimes(1);
  });

  it('accepts the ports in allowedPorts on the first URL and on same-origin redirect hops', async () => {
    const net = fakeTransport({
      'https://cdn.example:8443/start': { status: 302, headers: { location: '/a.png' } },
      'https://cdn.example:8443/a.png': { status: 200 },
    });
    const result = await fetchPublicMediaBytes('https://cdn.example:8443/start', {
      maxBytes: 1024, allowedPorts: [8443], transport: net.transport,
    });
    expect(result.ok).toBe(true);
    expect(net.requestBytes).toHaveBeenCalledTimes(2);
    // Same origin on every hop, so the allowed ports apply; other ports, and the other rules, still apply.
    expect(await fetchPublicMediaBytes('https://cdn.example:22/a', { maxBytes: 1024, allowedPorts: [8443], transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked', reason: 'port' });
    expect(await fetchPublicMediaBytes('https://10.0.0.1:8443/a', { maxBytes: 1024, allowedPorts: [8443], transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked' });
  });

  it('applies allowedPorts to the first origin only: a redirect to another host or port gets the default port', async () => {
    const net = fakeTransport({
      'https://cdn.example:8443/to-other': { status: 302, headers: { location: 'https://other.example:8443/a.png' } },
      'https://cdn.example:8443/to-other-port': { status: 302, headers: { location: 'https://cdn.example:9443/a.png' } },
      'https://cdn.example:8443/to-default': { status: 302, headers: { location: 'https://other.example/a.png' } },
      'https://other.example/a.png': { status: 200 },
    });
    const options = { maxBytes: 1024, allowedPorts: [8443, 9443], transport: net.transport };
    expect(await fetchPublicMediaBytes('https://cdn.example:8443/to-other', options))
      .toEqual({ ok: false, code: 'blocked', host: 'other.example', reason: 'port' });
    expect(await fetchPublicMediaBytes('https://cdn.example:8443/to-other-port', options))
      .toEqual({ ok: false, code: 'blocked', host: 'cdn.example', reason: 'port' });
    expect((await fetchPublicMediaBytes('https://cdn.example:8443/to-default', options)).ok).toBe(true);
    expect(net.requestBytes.mock.calls.map(([url]) => url.href)).toEqual([
      'https://cdn.example:8443/to-other',
      'https://cdn.example:8443/to-other-port',
      'https://cdn.example:8443/to-default',
      'https://other.example/a.png',
    ]);
  });

  it('applies the same origin rule to http hops with allowHttp', async () => {
    const net = fakeTransport({
      'http://voice.example:8080/a': { status: 302, headers: { location: 'http://other.example:8080/a.amr' } },
      'http://voice.example:8080/b': { status: 200 },
    });
    const options = { maxBytes: 1024, allowHttp: true, allowedPorts: [8080], transport: net.transport };
    expect((await fetchPublicMediaBytes('http://voice.example:8080/b', options)).ok).toBe(true);
    expect(await fetchPublicMediaBytes('http://voice.example:8080/a', options))
      .toEqual({ ok: false, code: 'blocked', host: 'other.example', reason: 'port' });
  });

  it.each([
    ['a zero-padded port (080 is 80, not https\'s default)', 'https://cdn.example:080/a.png', 'cdn.example'],
    ['a public IPv6 literal on 8443', 'https://[2606:4700::1111]:8443/a.png', '[2606:4700::1111]'],
    ['userinfo before the host', 'https://user@cdn.example:22/a.png', 'cdn.example'],
  ])('refuses %s with reason port', async (_label, url, host) => {
    const net = fakeTransport({});
    expect(await fetchPublicMediaBytes(url, { maxBytes: 1024, transport: net.transport }))
      .toEqual({ ok: false, code: 'blocked', host, reason: 'port' });
    expect(net.requestBytes).not.toHaveBeenCalled();
  });

  it('refuses a documentation-range IPv6 literal on a non-default port', async () => {
    const net = fakeTransport({});
    expect(await fetchPublicMediaBytes('https://[2001:db8::1]:8443/', { maxBytes: 1024, transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked' });
    expect(net.requestBytes).not.toHaveBeenCalled();
  });

  it('resolves a relative redirect against the previous hop (keeping its port) and checks every hop again', async () => {
    const net = fakeTransport({
      'https://cdn.example/start': { status: 302, headers: { location: '/next' } },
      'https://cdn.example/next': { status: 302, headers: { location: '//other.example:22/x' } },
      'https://cdn.example:8443/start': { status: 302, headers: { location: 'next' } },
      'https://cdn.example:8443/next': { status: 200 },
    });
    expect(await fetchPublicMediaBytes('https://cdn.example/start', { maxBytes: 1024, transport: net.transport }))
      .toEqual({ ok: false, code: 'blocked', host: 'other.example', reason: 'port' });
    // A relative hop stays on the first origin's port; without allowedPorts that port is refused at the first hop.
    expect(await fetchPublicMediaBytes('https://cdn.example:8443/start', { maxBytes: 1024, transport: net.transport }))
      .toMatchObject({ ok: false, reason: 'port' });
    expect((await fetchPublicMediaBytes('https://cdn.example:8443/start', { maxBytes: 1024, allowedPorts: [8443], transport: net.transport })).ok)
      .toBe(true);
    expect(net.requestBytes.mock.calls.map(([url]) => url.href)).toEqual([
      'https://cdn.example/start',
      'https://cdn.example/next',
      'https://cdn.example:8443/start',
      'https://cdn.example:8443/next',
    ]);
  });

  it('keeps the port of a trusted origin, and only that exact origin', async () => {
    const net = fakeTransport({
      'https://satori.example:5140/v1/proxy/a.png': { status: 200 },
      'http://satori.example:5140/v1/proxy/a.amr': { status: 200 },
    });
    const trustedOrigins = ['https://satori.example:5140', 'http://satori.example:5140'];
    expect(await fetchPublicMediaBytes('https://satori.example:5140/v1/proxy/a.png', { maxBytes: 1024, trustedOrigins, transport: net.transport }))
      .toMatchObject({ ok: true });
    expect(await fetchPublicMediaBytes('http://satori.example:5140/v1/proxy/a.amr', { maxBytes: 1024, allowHttp: true, trustedOrigins, transport: net.transport }))
      .toMatchObject({ ok: true });
    // Another port on the same host, the same port on another host, and http without allowHttp stay refused.
    expect(await fetchPublicMediaBytes('https://satori.example:22/a', { maxBytes: 1024, trustedOrigins, transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked', reason: 'port' });
    expect(await fetchPublicMediaBytes('https://other.example:5140/a', { maxBytes: 1024, trustedOrigins, transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked', reason: 'port' });
    expect(await fetchPublicMediaBytes('http://satori.example:5140/v1/proxy/a.amr', { maxBytes: 1024, trustedOrigins, transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked' });
    expect(net.requestBytes).toHaveBeenCalledTimes(2);
  });

  it('trusts an origin only when the URL starts there: a public URL cannot redirect into it', async () => {
    const net = fakeTransport({
      'https://cdn.example/start': { status: 302, headers: { location: 'https://satori.example:5140/v1/admin' } },
      'https://satori.example:5140/v1/proxy/a': { status: 302, headers: { location: '/v1/proxy/b' } },
      'https://satori.example:5140/v1/proxy/b': { status: 200 },
    });
    const trustedOrigins = ['https://satori.example:5140'];
    expect(await fetchPublicMediaBytes('https://cdn.example/start', { maxBytes: 1024, trustedOrigins, transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked', reason: 'port' });
    expect(await fetchPublicMediaBytes('https://satori.example:5140/v1/proxy/a', { maxBytes: 1024, trustedOrigins, transport: net.transport }))
      .toMatchObject({ ok: true });
    expect(net.requestBytes.mock.calls.map(([url]) => (url as URL).href)).toEqual([
      'https://cdn.example/start', 'https://satori.example:5140/v1/proxy/a', 'https://satori.example:5140/v1/proxy/b',
    ]);
  });

  it('does not let a trusted origin redirect to another port, nor reach a private host', async () => {
    const net = fakeTransport({
      'https://satori.example:5140/start': { status: 302, headers: { location: 'https://satori.example:6379/next' } },
    });
    expect(await fetchPublicMediaBytes('https://satori.example:5140/start', { maxBytes: 1024, trustedOrigins: ['https://satori.example:5140'], transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked', reason: 'port' });
    const local = fakeTransport({});
    expect(await fetchPublicMediaBytes('https://10.0.0.1:5140/a', { maxBytes: 1024, trustedOrigins: ['https://10.0.0.1:5140'], transport: local.transport }))
      .toMatchObject({ ok: false, code: 'blocked' });
    expect(local.requestBytes).not.toHaveBeenCalled();
  });

  it('never puts the full URL in the result', async () => {
    const net = fakeTransport({});
    const result = await fetchPublicMediaBytes('https://cdn.example:22/secret/path?token=hunter2', { maxBytes: 1024, transport: net.transport });
    expect(JSON.stringify(result)).not.toMatch(/secret|hunter2|:22/u);
  });
});

describe('isDefaultOrAllowedPort', () => {
  it('treats an explicit default port as no port and ignores invalid allowed ports', () => {
    expect(isDefaultOrAllowedPort(new URL('https://a.example:443/'))).toBe(true);
    expect(isDefaultOrAllowedPort(new URL('http://a.example:80/'))).toBe(true);
    expect(isDefaultOrAllowedPort(new URL('http://a.example:443/'))).toBe(false);
    expect(isDefaultOrAllowedPort(new URL('https://a.example:0/'), [0])).toBe(false);
    expect(isDefaultOrAllowedPort(new URL('https://a.example:8443/'), [8443])).toBe(true);
  });
});
