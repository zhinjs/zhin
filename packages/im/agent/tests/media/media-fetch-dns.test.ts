import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUrlAsBase64 } from '../../src/media/media-normalize.js';
import { NodeNetworkTransport, type PinnedAddressConnect } from '../../src/security/turn-network-client.js';
import { hostnameResolvesToBlockedAddress } from '../../src/security/network-policy.js';
import { WHOLE_SCENE_IDS } from '../../src/session-profile.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('hostnameResolvesToBlockedAddress', () => {
  it('flags names with any private address and literal private IPs', async () => {
    const resolve = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.7' }];
    await expect(hostnameResolvesToBlockedAddress('rebind.example', resolve)).resolves.toBe(true);
    await expect(hostnameResolvesToBlockedAddress('[::1]')).resolves.toBe(true);
    await expect(hostnameResolvesToBlockedAddress('169.254.169.254')).resolves.toBe(true);
  });

  it('passes public names and leaves unresolvable names to the request itself', async () => {
    await expect(hostnameResolvesToBlockedAddress('cdn.example', async () => [{ address: '93.184.216.34' }])).resolves.toBe(false);
    await expect(hostnameResolvesToBlockedAddress('nx.example', async () => { throw new Error('ENOTFOUND'); })).resolves.toBe(false);
  });
});

type Connect = PinnedAddressConnect;
const ok = (body: Uint8Array): Awaited<ReturnType<Connect>> => ({ status: 200, statusText: 'OK', headers: {}, body });

/** The pinned Node transport with a scripted resolver and connection (no real DNS or sockets). */
function pinned(resolve: (host: string) => string, reply: Connect = async () => ok(PNG)) {
  const lookup = vi.fn(async (host: string) => [{ address: resolve(host), family: 4 }]);
  const connect = vi.fn(reply);
  return { lookup, connect, transport: new NodeNetworkTransport({ lookup, connect }) };
}

describe('fetchUrlAsBase64 — DNS-resolved private targets', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('refuses a public-looking host that resolves to a private address without connecting', async () => {
    const net = pinned(() => '127.0.0.1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchUrlAsBase64('https://internal.example/a.png', 1024 * 1024, undefined, undefined, [], net.transport)).resolves.toBeNull();
    expect(net.lookup).toHaveBeenCalledWith('internal.example');
    expect(net.connect).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checks every redirect hop', async () => {
    const net = pinned(host => (host === 'cdn.example' ? '93.184.216.34' : '10.1.2.3'), async (url) => (url.host === 'cdn.example'
      ? { status: 302, statusText: 'Found', headers: { location: 'https://inner.example/a.png' }, body: new Uint8Array() }
      : ok(PNG)));
    await expect(fetchUrlAsBase64('https://cdn.example/a.png', 1024 * 1024, undefined, undefined, [], net.transport)).resolves.toBeNull();
    expect(net.connect).toHaveBeenCalledTimes(1);
    expect(net.lookup.mock.calls.map(([host]) => host)).toEqual(['cdn.example', 'inner.example']);
  });

  it('blocks DNS rebinding: the connection goes to the address checked at preflight, never a re-resolved one', async () => {
    // Preflight sees a public address; any later lookup (the old connect-time resolution) would see loopback.
    let lookups = 0;
    const net = pinned(() => (lookups++ === 0 ? '93.184.216.34' : '127.0.0.1'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchUrlAsBase64('https://rebind.example/a.png', 1024 * 1024, undefined, undefined, [], net.transport))
      .resolves.toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(net.lookup).toHaveBeenCalledTimes(1);
    expect(net.connect).toHaveBeenCalledTimes(1);
    expect(net.connect.mock.calls[0]![1]).toBe('93.184.216.34');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not hand the name to an environment proxy (NODE_USE_ENV_PROXY): no global fetch, connection to the checked address', async () => {
    // With NODE_USE_ENV_PROXY=1 the global fetch sends the host name to the proxy, which resolves it again
    // and bypasses the preflight check. The pinned transport only ever connects to the address it checked.
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.invalid:8080');
    vi.stubEnv('HTTP_PROXY', 'http://proxy.invalid:8080');
    try {
      const net = pinned(() => '93.184.216.34');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('global fetch must not be used'));
      await expect(fetchUrlAsBase64('https://cdn.example/a.png', 1024 * 1024, undefined, undefined, [], net.transport))
        .resolves.toMatchObject({ kind: 'image' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(net.connect.mock.calls[0]![1]).toBe('93.184.216.34');
      expect(net.connect.mock.calls[0]![0].hostname).toBe('cdn.example');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('applies the domain allowlist to redirect hops', async () => {
    const net = pinned(() => '93.184.216.34', async (url) => (url.host === 'cdn.example'
      ? { status: 302, statusText: 'Found', headers: { location: 'https://other.example/a.png' }, body: new Uint8Array() }
      : ok(PNG)));
    await expect(fetchUrlAsBase64('https://cdn.example/a.png', 1024 * 1024, undefined, undefined, ['cdn.example'], net.transport)).resolves.toBeNull();
    expect(net.connect).toHaveBeenCalledTimes(1);
  });

  it('caps the body at maxBytes', async () => {
    const net = pinned(() => '93.184.216.34', async (_url, _address, _headers, _signal, maxBytes) => {
      if (PNG.byteLength > maxBytes) throw new Error(`Network response exceeds ${maxBytes} bytes`);
      return ok(PNG);
    });
    await expect(fetchUrlAsBase64('https://cdn.example/a.png', 8, undefined, undefined, [], net.transport)).resolves.toBeNull();
  });

  it('still downloads from a host that resolves publicly', async () => {
    const net = pinned(() => '93.184.216.34');
    await expect(fetchUrlAsBase64('https://cdn.example/a.png', 1024 * 1024, undefined, undefined, [], net.transport))
      .resolves.toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(net.connect.mock.calls[0]![1]).toBe('93.184.216.34');
  });
});

describe('WHOLE_SCENE_IDS', () => {
  it('is the single definition of the scene-wide member ids', () => {
    expect([...WHOLE_SCENE_IDS]).toEqual(['0', 'all']);
  });
});
