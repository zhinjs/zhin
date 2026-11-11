import { afterEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

import { fetchUrlAsBase64 } from '../../src/media/media-normalize.js';
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

describe('fetchUrlAsBase64 — DNS-resolved private targets', () => {
  afterEach(() => { vi.restoreAllMocks(); lookup.mockReset(); });

  it('refuses a public-looking host that resolves to a private address without fetching', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(PNG, { status: 200 }));
    await expect(fetchUrlAsBase64('https://internal.example/a.png', 1024 * 1024)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checks every redirect hop', async () => {
    lookup.mockImplementation(async (host: string) => [{ address: host === 'cdn.example' ? '93.184.216.34' : '10.1.2.3', family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://inner.example/a.png' } }));
    await expect(fetchUrlAsBase64('https://cdn.example/a.png', 1024 * 1024)).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('still downloads from a host that resolves publicly', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(PNG, { status: 200 }));
    await expect(fetchUrlAsBase64('https://cdn.example/a.png', 1024 * 1024)).resolves.toMatchObject({ kind: 'image', mimeType: 'image/png' });
  });
});

describe('WHOLE_SCENE_IDS', () => {
  it('is the single definition of the scene-wide member ids', () => {
    expect([...WHOLE_SCENE_IDS]).toEqual(['0', 'all']);
  });
});
