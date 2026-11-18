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

  it('accepts the ports in allowedPorts, on the first URL and on redirect hops', async () => {
    const net = fakeTransport({
      'https://cdn.example:8443/start': { status: 302, headers: { location: 'https://cdn.example:9443/a.png' } },
      'https://cdn.example:9443/a.png': { status: 200 },
    });
    const result = await fetchPublicMediaBytes('https://cdn.example:8443/start', {
      maxBytes: 1024, allowedPorts: [8443, 9443], transport: net.transport,
    });
    expect(result.ok).toBe(true);
    expect(net.requestBytes).toHaveBeenCalledTimes(2);
    // allowedPorts only adds ports: other ports, and the other rules, still apply.
    expect(await fetchPublicMediaBytes('https://cdn.example:22/a', { maxBytes: 1024, allowedPorts: [8443], transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked', reason: 'port' });
    expect(await fetchPublicMediaBytes('https://10.0.0.1:8443/a', { maxBytes: 1024, allowedPorts: [8443], transport: net.transport }))
      .toMatchObject({ ok: false, code: 'blocked' });
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
