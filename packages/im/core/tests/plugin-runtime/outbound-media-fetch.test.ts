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

describe('fetchOutboundMedia — port rule (#1250 第 48 批)', () => {
  it.each([22, 8443, 0, 65535])('refuses https port %i as outbound_media_url_blocked, reason port, without resolving', async (port) => {
    const warn = vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const net = fakeNetwork({ 'public-host.example': '93.184.216.34' }, {});
    const error = await refusal(net.fetchMedia(`https://public-host.example:${port}/a.png?token=hunter2`, { source: 'test' }));
    expect(error.code).toBe('outbound_media_url_blocked');
    expect(error.reason).toBe('port');
    expect(error.host).toBe('public-host.example');
    expect(isOutboundMediaRefused(error)).toBe(true);
    expect(net.lookup).not.toHaveBeenCalled();
    expect(net.connect).not.toHaveBeenCalled();
    // Neither the error text nor the log line carries the URL (path, query or port).
    expect(error.message).toBe('outbound_media_url_blocked (public-host.example) reason=port');
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('outbound_media_url_blocked');
    expect(line).toContain('public-host.example');
    expect(line).toContain('port');
    expect(line).not.toContain('a.png');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain(`:${port}`);
  });

  it('accepts 443 written out or not', async () => {
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34' }, {
      'https://cdn.example/a.png': { status: 200, body: PNG },
    });
    await expect(net.fetchMedia('https://cdn.example/a.png')).resolves.toMatchObject({ url: 'https://cdn.example/a.png' });
    await expect(net.fetchMedia('https://cdn.example:443/a.png')).resolves.toMatchObject({ url: 'https://cdn.example/a.png' });
    expect(net.connect).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect to a non-default port', async () => {
    vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34', 'other.example': '93.184.216.35' }, {
      'https://cdn.example/a.png': { status: 302, headers: { location: 'https://other.example:8443/b.png' } },
    });
    const error = await refusal(net.fetchMedia('https://cdn.example/a.png'));
    expect(error.code).toBe('outbound_media_url_blocked');
    expect(error.reason).toBe('port');
    expect(error.host).toBe('other.example');
    expect(net.connect).toHaveBeenCalledTimes(1);
  });

  it('accepts the ports a caller lists in allowedPorts, and only those', async () => {
    vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34' }, {
      'https://cdn.example:8443/a.png': { status: 200, body: PNG },
    });
    await expect(net.fetchMedia('https://cdn.example:8443/a.png', { allowedPorts: [8443] }))
      .resolves.toMatchObject({ url: 'https://cdn.example:8443/a.png' });
    expect((await refusal(net.fetchMedia('https://cdn.example:9443/a.png', { allowedPorts: [8443] }))).reason).toBe('port');
    expect((await refusal(net.fetchMedia('https://cdn.example:8443/a.png'))).reason).toBe('port');
  });

  it('keeps other refusals without a port reason', async () => {
    vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const net = fakeNetwork({}, {});
    expect((await refusal(net.fetchMedia('https://10.0.0.8/a.png'))).reason).toBeUndefined();
  });
});

describe('fetchOutboundMedia — deadline, concurrency and probes (#1250 第 46 批 L1 / L7)', () => {
  it('fails within the deadline when the resolver hangs', async () => {
    const lookup = vi.fn(() => new Promise<never>(() => undefined));
    const connect = vi.fn();
    const fetchMedia = createOutboundMediaFetcher({ lookup, connect, maxConcurrent: 1 });
    const started = Date.now();
    const error = await refusal(fetchMedia('https://slow-dns.example/a.png', { timeoutMs: 200 }));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(error.code).toBe('outbound_media_fetch_failed');
    expect(error.refused).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it('runs at most maxConcurrent downloads at once and starts the next as one finishes', async () => {
    let active = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const connect = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => gates.push(resolve));
      active -= 1;
      return { status: 200, statusText: 'OK', headers: {}, body: PNG };
    });
    const fetchMedia = createOutboundMediaFetcher({ lookup, connect, maxConcurrent: 2 });
    const downloads = Array.from({ length: 5 }, (_, index) => fetchMedia(`https://cdn.example/${index}.png`));
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    gates.shift()!();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(3));
    while (connect.mock.calls.length < 5 || gates.length > 0) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0));
      gates.shift()!();
    }
    await expect(Promise.all(downloads)).resolves.toHaveLength(5);
    expect(peak).toBe(2);
  });

  it('a queued request honours its signal and deadline and never connects', async () => {
    const release: Array<() => void> = [];
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const connect = vi.fn(async () => {
      await new Promise<void>(resolve => release.push(resolve));
      return { status: 200, statusText: 'OK', headers: {}, body: PNG };
    });
    const fetchMedia = createOutboundMediaFetcher({ lookup, connect, maxConcurrent: 1 });
    const first = fetchMedia('https://cdn.example/first.png');
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const cancelled = fetchMedia('https://cdn.example/cancelled.png', { signal: controller.signal });
    const timedOut = fetchMedia('https://cdn.example/late.png', { timeoutMs: 100 });
    controller.abort(new Error('stop'));
    await expect(cancelled).rejects.toThrow('stop');
    const late = await refusal(timedOut);
    expect(late.code).toBe('outbound_media_fetch_failed');
    expect(late.host).toBe('cdn.example');
    release.shift()!();
    await expect(first).resolves.toMatchObject({ url: 'https://cdn.example/first.png' });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('a probe whose server ignored Range is not a refusal and is logged at debug, not warn', async () => {
    const warn = vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const debug = vi.spyOn(getLogger('im.outbound'), 'debug').mockImplementation(() => undefined);
    const net = fakeNetwork({ 'cdn.example': '93.184.216.34' }, {
      'https://cdn.example/whole.png': { status: 200, body: new Uint8Array(64) },
    });
    const probe = await refusal(net.fetchMedia('https://cdn.example/whole.png', { maxBytes: 16, probe: true, source: 'qq' }));
    expect(probe.code).toBe('outbound_media_too_large');
    expect(probe.refused).toBe(false);
    expect(isOutboundMediaRefused(probe)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(String(debug.mock.calls[0]?.[0])).toContain('outbound_media_too_large');
    // Address refusals stay refusals (and warnings) even for a probe.
    const blocked = await refusal(net.fetchMedia('https://169.254.169.254/a.png', { probe: true }));
    expect(blocked.refused).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
