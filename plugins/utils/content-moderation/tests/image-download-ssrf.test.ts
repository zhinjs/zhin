import { afterEach, describe, expect, it, vi } from 'vitest';

// In production fetchPublic connects through a pinned socket (`requestPinned`, covered by
// public-fetch.test.ts); here each checked hop goes to the stubbed global fetch instead.
vi.mock('../src/public-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/public-fetch.js')>();
  const viaGlobalFetch: import('../src/public-fetch.js').PinnedRequest = (url, _address, init, signal) =>
    fetch(url.href, { method: init.method, headers: init.headers, redirect: 'manual', signal });
  return {
    ...actual,
    fetchPublic: (input: string, options: import('../src/public-fetch.js').PublicFetchOptions = {}) =>
      actual.fetchPublic(input, { request: viaGlobalFetch, ...options }),
  };
});


const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

import { HttpModerationProvider } from '../src/index.js';
import type { ScanInput } from '../src/types.js';

/** #1250 第 45 批: forceUpload downloads chat image URLs on this host, so only public addresses are fetched. */
function provider(moderationFetch: typeof fetch) {
  return new HttpModerationProvider({
    id: 'http-1',
    type: 'http',
    enabled: true,
    onError: 'closed',
    url: 'https://moderation.example/scan',
    headers: {},
    timeoutMs: 2000,
    forceUpload: true,
  }, { fetch: moderationFetch });
}

function scan(url: string): ScanInput {
  return {
    text: '',
    images: [{ index: 0, segmentIndex: 0, url }],
    direction: 'inbound',
    context: { adapter: 'sandbox', endpoint: 'bot', conversationKind: 'group', conversationId: 'g1', sender: 'u1' },
  } as unknown as ScanInput;
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

afterEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset();
});

describe('content-moderation image download address policy', () => {
  it.each([
    'http://127.0.0.1/a.png',
    'https://10.0.0.5/a.png',
    'http://169.254.169.254/latest/meta-data/',
    'https://[::1]/a.png',
  ])('refuses %s before any request; the scan fails per onError', async (url) => {
    const download = vi.spyOn(globalThis, 'fetch');
    const moderationFetch = vi.fn();
    const result = await provider(moderationFetch as unknown as typeof fetch).scan(scan(url));
    expect(download).not.toHaveBeenCalled();
    expect(moderationFetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: true, severity: 'critical', reason: expect.stringContaining('refusing to fetch') });
  });

  it('refuses a name resolving to a private address and a redirect into the internal network', async () => {
    lookup.mockImplementation(async (host: string) => [{ address: host === 'cdn.example.com' ? '93.184.216.34' : '10.9.8.7', family: 4 }]);
    const download = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://inner.example.com/a.png' } }));
    const moderationFetch = vi.fn();

    await expect(provider(moderationFetch as unknown as typeof fetch).scan(scan('https://private.example.com/a.png')))
      .resolves.toMatchObject({ error: true, reason: expect.stringContaining('non-public') });
    expect(download).not.toHaveBeenCalled();

    await expect(provider(moderationFetch as unknown as typeof fetch).scan(scan('https://cdn.example.com/a.png')))
      .resolves.toMatchObject({ error: true, reason: expect.stringContaining('non-public') });
    expect(download).toHaveBeenCalledTimes(1);
    expect(moderationFetch).not.toHaveBeenCalled();
  });

  it('still uploads an image from a public address', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
    const moderationFetch = vi.fn(async () => new Response(JSON.stringify({ severity: 'pass' }), { status: 200 }));
    const result = await provider(moderationFetch as unknown as typeof fetch).scan(scan('https://cdn.example.com/a.png'));
    expect(result).toMatchObject({ severity: 'pass' });
    expect(result.error).toBeUndefined();
    expect(moderationFetch).toHaveBeenCalledOnce();
  });
});
