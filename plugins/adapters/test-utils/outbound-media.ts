import { expect, vi } from 'vitest';
import { createOutboundMediaFetcher, type OutboundMediaFetcher } from '../../../packages/im/core/src/built/outbound-media-fetch.js';

/** Smallest valid PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Public host that serves {@link PNG}. */
export const PUBLIC_MEDIA_URL = 'https://cdn.example/a.png';

/**
 * Media URLs an adapter must never download on this host (#1250 第 46 批): a metadata address, plain
 * http, a public name that redirects to the metadata address, a public-looking name that resolves to a
 * private address.
 */
export const BLOCKED_MEDIA_URLS = [
  ['metadata address', 'https://169.254.169.254/latest/meta-data/iam/security-credentials/'],
  ['plain http', 'http://cdn.example/a.png'],
  ['redirect to a private address', 'https://redirect.example/a.png'],
  ['name resolving to a private address', 'https://inner.example/a.png'],
] as const;

const DNS: Readonly<Record<string, string>> = {
  'cdn.example': '93.184.216.34',
  'redirect.example': '93.184.216.35',
  'inner.example': '10.0.0.5',
};
const PUBLIC_ADDRESSES = new Set(['93.184.216.34', '93.184.216.35']);

/**
 * The real core outbound media fetcher over a scripted resolver and pinned connection: no real DNS or
 * sockets, and every connection attempt is recorded with the address it would open.
 */
export function fakeOutboundMediaNetwork(): {
  readonly fetchMedia: OutboundMediaFetcher;
  readonly connected: ReadonlyArray<{ readonly host: string; readonly address: string }>;
  /** Asserts nothing but the public test hosts was ever connected to, and the global fetch was never used. */
  expectNoPrivateConnection(): void;
  restore(): void;
} {
  const connected: Array<{ host: string; address: string }> = [];
  const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('outbound media must not use the global fetch');
  });
  const fetchMedia = createOutboundMediaFetcher({
    lookup: async (host) => {
      const address = DNS[host];
      if (!address) throw new Error(`ENOTFOUND ${host}`);
      return [{ address, family: 4 }];
    },
    connect: async (url, address) => {
      connected.push({ host: url.hostname, address });
      if (url.hostname === 'redirect.example') {
        return { status: 302, statusText: 'Found', headers: { location: 'https://169.254.169.254/latest/meta-data/' }, body: new Uint8Array() };
      }
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'image/png' }, body: PNG };
    },
  });
  return {
    fetchMedia,
    connected,
    expectNoPrivateConnection() {
      for (const entry of connected) expect(PUBLIC_ADDRESSES.has(entry.address)).toBe(true);
      expect(globalFetch).not.toHaveBeenCalled();
    },
    restore() { globalFetch.mockRestore(); },
  };
}
