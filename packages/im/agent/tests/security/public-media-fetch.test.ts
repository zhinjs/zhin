import { afterEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

import { fetchPublicMediaBytes } from '../../src/security/public-media-fetch.js';
import { NodeNetworkTransport, type NetworkTransport } from '../../src/security/turn-network-client.js';

type BinaryResponse = Awaited<ReturnType<NonNullable<NetworkTransport['requestBytes']>>>;

function fakeTransport(responses: Record<string, BinaryResponse>) {
  const requestBytes = vi.fn(async (url: URL) => {
    const response = responses[url.href];
    if (!response) throw new Error(`unexpected request to ${url.host}`);
    return response;
  });
  const transport: NetworkTransport = { request: vi.fn(), requestBytes };
  return { transport, requestBytes };
}

const ok = (body: Uint8Array, contentType = 'audio/ogg'): BinaryResponse =>
  ({ status: 200, statusText: 'OK', headers: { 'content-type': contentType }, body });
const redirect = (location: string): BinaryResponse =>
  ({ status: 302, statusText: 'Found', headers: { location }, body: new Uint8Array() });

afterEach(() => { lookup.mockReset(); });

describe('fetchPublicMediaBytes (#1250 第 45 批 speech-url-ssrf)', () => {
  it('refuses plain http without connecting', async () => {
    const { transport, requestBytes } = fakeTransport({});
    await expect(fetchPublicMediaBytes('http://media.example/a.ogg', { maxBytes: 1024, transport }))
      .resolves.toEqual({ ok: false, code: 'blocked', host: 'media.example' });
    expect(requestBytes).not.toHaveBeenCalled();
  });

  it.each([
    'https://127.0.0.1/a.ogg',
    'https://10.1.2.3/a.ogg',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/a.ogg',
    'https://localhost/a.ogg',
    'https://metadata.google.internal/a.ogg',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s without connecting', async (url) => {
    const { transport, requestBytes } = fakeTransport({});
    await expect(fetchPublicMediaBytes(url, { maxBytes: 1024, transport }))
      .resolves.toMatchObject({ ok: false, code: 'blocked' });
    expect(requestBytes).not.toHaveBeenCalled();
  });

  it('refuses a public-looking name that resolves to a private address, on the address the connection would use', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);
    const transport = new NodeNetworkTransport();
    const connect = vi.spyOn(transport, 'requestBytes');
    await expect(fetchPublicMediaBytes('https://voice.example/a.ogg', { maxBytes: 1024, transport }))
      .resolves.toEqual({ ok: false, code: 'blocked', host: 'voice.example' });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('voice.example', { all: true, verbatim: true });
  });

  it('refuses a name with any private address among public ones (rebinding answer set)', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(fetchPublicMediaBytes('https://voice.example/a.ogg', { maxBytes: 1024, transport: new NodeNetworkTransport() }))
      .resolves.toMatchObject({ ok: false, code: 'blocked' });
  });

  it('checks every redirect hop: a redirect to an internal address is refused', async () => {
    const { transport, requestBytes } = fakeTransport({
      'https://cdn.example/a.ogg': redirect('https://169.254.169.254/latest/meta-data/'),
    });
    await expect(fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, transport }))
      .resolves.toEqual({ ok: false, code: 'blocked', host: '169.254.169.254' });
    expect(requestBytes).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to plain http and to a name resolving privately', async () => {
    const http = fakeTransport({ 'https://cdn.example/a.ogg': redirect('http://cdn.example/a.ogg') });
    await expect(fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, transport: http.transport }))
      .resolves.toMatchObject({ ok: false, code: 'blocked' });

    lookup.mockImplementation(async (host: string) => [{ address: host === 'inner.example' ? '192.168.1.5' : '93.184.216.34', family: 4 }]);
    const node = new NodeNetworkTransport();
    vi.spyOn(node, 'requestBytes').mockImplementationOnce(async () => redirect('https://inner.example/a.ogg'));
    await expect(fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, transport: node }))
      .resolves.toEqual({ ok: false, code: 'blocked', host: 'inner.example' });
  });

  it('downloads a public https address, following a public redirect', async () => {
    const { transport } = fakeTransport({
      'https://cdn.example/a.ogg': redirect('/b.ogg'),
      'https://cdn.example/b.ogg': ok(Uint8Array.from([1, 2, 3]), 'audio/ogg; codecs=opus'),
    });
    const result = await fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, transport });
    expect(result).toMatchObject({ ok: true, mimeType: 'audio/ogg', url: 'https://cdn.example/b.ogg' });
    expect(result.ok && [...result.bytes]).toEqual([1, 2, 3]);
  });

  it('reports size, status and redirect-limit failures without the URL', async () => {
    const big = fakeTransport({ 'https://cdn.example/a.ogg': ok(new Uint8Array(2048)) });
    await expect(fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, transport: big.transport }))
      .resolves.toEqual({ ok: false, code: 'too_large', host: 'cdn.example' });

    const tooLarge: NetworkTransport = {
      request: vi.fn(),
      requestBytes: vi.fn(async () => { throw new Error('Network response exceeds 1024 bytes'); }),
    };
    await expect(fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, transport: tooLarge }))
      .resolves.toMatchObject({ ok: false, code: 'too_large' });

    const missing = fakeTransport({ 'https://cdn.example/a.ogg': { status: 404, statusText: 'Not Found', headers: {}, body: new Uint8Array() } });
    await expect(fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, transport: missing.transport }))
      .resolves.toEqual({ ok: false, code: 'http_status', host: 'cdn.example', status: 404 });

    const loop = fakeTransport({ 'https://cdn.example/a.ogg': redirect('https://cdn.example/a.ogg') });
    await expect(fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, maxRedirects: 2, transport: loop.transport }))
      .resolves.toMatchObject({ ok: false, code: 'failed', status: 302 });
    expect(loop.requestBytes).toHaveBeenCalledTimes(3);
  });

  it('gives up when the time budget runs out', async () => {
    const hang: NetworkTransport = {
      request: vi.fn(),
      requestBytes: vi.fn((_url: URL, _headers: unknown, signal: AbortSignal) => new Promise<BinaryResponse>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })),
    };
    await expect(fetchPublicMediaBytes('https://cdn.example/a.ogg', { maxBytes: 1024, timeoutMs: 20, transport: hang }))
      .resolves.toMatchObject({ ok: false, code: 'failed' });
  });
});
