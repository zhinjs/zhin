import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLogger } from '@zhin.js/logger';
import {
  createOutboundMediaFetcher,
  isOutboundMediaRefused,
  OutboundMediaFetchError,
  outboundMediaNotice,
} from '../../src/built/outbound-media-fetch.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Reply = { status: number; headers?: Record<string, string>; body?: Uint8Array };

/** A resolver and a pinned connection that record what the fetcher asked for. */
function fakeNetwork(dns: Record<string, string | string[]>, replies: Record<string, Reply>) {
  const lookup = vi.fn(async (host: string) => {
    const answer = dns[host];
    if (!answer) throw new Error(`ENOTFOUND ${host}`);
    return (Array.isArray(answer) ? answer : [answer]).map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
  });
  const connect = vi.fn(async (url: URL, address: string, headers: Readonly<Record<string, string>>, _signal: AbortSignal, maxBytes: number) => {
    const reply = replies[url.href];
    if (!reply) throw new Error(`unexpected request to ${url.host}`);
    const body = reply.body ?? new Uint8Array();
    if (body.byteLength > maxBytes) throw new Error(`Network response exceeds ${maxBytes} bytes`);
    return { status: reply.status, statusText: '', headers: reply.headers ?? {}, body, address, sent: headers };
  });
  return { lookup, connect, fetchMedia: createOutboundMediaFetcher({ lookup, connect }) };
}

async function refusal(promise: Promise<unknown>): Promise<OutboundMediaFetchError> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(OutboundMediaFetchError);
  return error as OutboundMediaFetchError;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchOutboundMedia (#1250 第 46 批 outbound-media-ssrf)', () => {
  it('downloads a public HTTPS URL through the pinned address', async () => {
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34' }, {
      'https://cdn.example/a.png': { status: 200, headers: { 'content-type': 'image/png; charset=binary' }, body: PNG },
    });
    const fetched = await net.fetchMedia('https://cdn.example/a.png');
    expect([...fetched.bytes]).toEqual([...PNG]);
    expect(fetched.mimeType).toBe('image/png');
    expect(net.connect).toHaveBeenCalledTimes(1);
    expect(net.connect.mock.calls[0]![1]).toBe('93.184.216.34');
  });

  it.each([
    ['plain http', 'http://cdn.example/a.png'],
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['loopback', 'https://127.0.0.1/a.png'],
    ['private IPv4', 'https://10.0.0.8/a.png'],
    ['IPv6 loopback', 'https://[::1]/a.png'],
    ['internal name', 'https://metadata.google.internal/a.png'],
    ['file scheme', 'file:///etc/passwd'],
  ])('refuses %s without resolving or connecting', async (_label, url) => {
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34' }, {});
    const warn = vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const error = await refusal(net.fetchMedia(url, { source: 'test' }));
    expect(error.code).toBe('outbound_media_url_blocked');
    expect(isOutboundMediaRefused(error)).toBe(true);
    expect(net.lookup).not.toHaveBeenCalled();
    expect(net.connect).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('refuses a public-looking name that resolves to a private address', async () => {
    const net = fakeNetwork({ 'evil.example': '169.254.169.254' }, {});
    const error = await refusal(net.fetchMedia('https://evil.example/a.png'));
    expect(error.code).toBe('outbound_media_url_blocked');
    expect(error.host).toBe('evil.example');
    expect(net.connect).not.toHaveBeenCalled();
  });

  it('refuses when any resolved address is private (rebinding answer set)', async () => {
    const net = fakeNetwork({ 'evil.example': ['93.184.216.34', '10.0.0.1'] }, {});
    expect((await refusal(net.fetchMedia('https://evil.example/a.png'))).code).toBe('outbound_media_url_blocked');
    expect(net.connect).not.toHaveBeenCalled();
  });

  it('connects to the address it checked: a resolver that flips to a private address later is never asked again', async () => {
    let calls = 0;
    const lookup = vi.fn(async () => [{ address: calls++ === 0 ? '93.184.216.34' : '127.0.0.1', family: 4 }]);
    const connect = vi.fn(async () => ({ status: 200, statusText: 'OK', headers: {}, body: PNG }));
    const fetchMedia = createOutboundMediaFetcher({ lookup, connect });
    await fetchMedia('https://rebind.example/a.png');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect((connect.mock.calls[0] as unknown[])[1]).toBe('93.184.216.34');
  });

  it.each([
    ['plain http', 'http://cdn.example/b.png'],
    ['metadata address', 'https://169.254.169.254/latest/meta-data/iam/'],
    ['name resolving privately', 'https://inner.example/b.png'],
  ])('checks every redirect hop again: refuses a redirect to %s', async (_label, location) => {
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34', 'inner.example': '192.168.1.5' }, {
      'https://cdn.example/a.png': { status: 302, headers: { location } },
    });
    const error = await refusal(net.fetchMedia('https://cdn.example/a.png'));
    expect(error.code).toBe('outbound_media_url_blocked');
    expect(net.connect).toHaveBeenCalledTimes(1);
    expect(net.connect.mock.calls[0]![0].host).toBe('cdn.example');
  });

  it('follows a redirect to another public HTTPS host', async () => {
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34', 'img.example': '93.184.216.35' }, {
      'https://cdn.example/a.png': { status: 301, headers: { location: 'https://img.example/b.png' } },
      'https://img.example/b.png': { status: 200, body: PNG },
    });
    const fetched = await net.fetchMedia('https://cdn.example/a.png');
    expect(fetched.url).toBe('https://img.example/b.png');
    expect(net.connect.mock.calls.map(call => call[1])).toEqual(['93.184.216.34', '93.184.216.35']);
  });

  it('caps the body and reports a refusal; other failures are not refusals', async () => {
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34' }, {
      'https://cdn.example/big.png': { status: 200, body: new Uint8Array(16) },
      'https://cdn.example/missing.png': { status: 404 },
    });
    const big = await refusal(net.fetchMedia('https://cdn.example/big.png', { maxBytes: 8 }));
    expect(big.code).toBe('outbound_media_too_large');
    expect(big.refused).toBe(true);
    const missing = await refusal(net.fetchMedia('https://cdn.example/missing.png'));
    expect(missing.code).toBe('outbound_media_http_status');
    expect(missing.status).toBe(404);
    expect(missing.refused).toBe(false);
  });

  it('logs the host only, never the path or query', async () => {
    const warn = vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const net = fakeNetwork({}, {});
    await refusal(net.fetchMedia('http://169.254.169.254/latest/meta-data/iam/security-credentials/role?token=secret', { source: 'lark' }));
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('outbound_media_url_blocked');
    expect(line).toContain('169.254.169.254');
    expect(line).toContain('lark');
    expect(line).not.toContain('meta-data');
    expect(line).not.toContain('secret');
  });

  it('keeps a caller cancellation a cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34' }, {});
    await expect(net.fetchMedia('https://cdn.example/a.png', { signal: controller.signal })).rejects.toThrow('stop');
    expect(net.connect).not.toHaveBeenCalled();
  });

  it('sends extra headers to the pinned connection', async () => {
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34' }, { 'https://cdn.example/a.png': { status: 206, body: PNG } });
    await net.fetchMedia('https://cdn.example/a.png', { headers: { Range: 'bytes=0-7' } });
    expect(net.connect.mock.calls[0]![2]).toEqual({ Range: 'bytes=0-7' });
  });

  it('words the replacement notice by segment type and locale', () => {
    expect(outboundMediaNotice('image')).toBe('[图片未发送：媒体地址不被允许]');
    expect(outboundMediaNotice('file', 'en')).toBe('[file not sent: media address not allowed]');
    expect(outboundMediaNotice('sticker')).toBe('[附件未发送：媒体地址不被允许]');
  });
});
