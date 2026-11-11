import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeed } from '../src/feed.js';

const publicLookup = async () => ['93.184.216.34'];
const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Demo</title>
<item><title>One</title><link>https://example.org/1</link><guid>g1</guid></item></channel></rss>`;

afterEach(() => vi.unstubAllGlobals());

describe('fetchFeed address policy', () => {
  it('parses a public feed and sends a timeout signal', async () => {
    const fetchMock = vi.fn(async () => new Response(FEED));
    vi.stubGlobal('fetch', fetchMock);
    const feed = await fetchFeed('https://example.org/feed.xml', 1000, publicLookup);
    expect(feed.title).toBe('Demo');
    expect(feed.items.map(item => item.guid)).toEqual(['g1']);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('manual');
  });

  it.each([
    'http://127.0.0.1:8080/feed', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/feed',
    'http://[::1]/feed', 'http://router.lan/feed', 'file:///etc/passwd',
  ])('refuses %s without any request', async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFeed(url, 1000)).rejects.toThrow(/refusing to fetch/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a public name that resolves to, or redirects to, an internal address', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/feed' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFeed('https://feeds.example.org/x', 1000, async () => ['192.168.1.10'])).rejects.toThrow(/non-public/);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(fetchFeed('https://feeds.example.org/x', 1000, publicLookup)).rejects.toThrow(/refusing to fetch/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects error statuses and oversized bodies without buffering them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(fetchFeed('https://example.org/feed.xml', 1000, publicLookup)).rejects.toThrow('Status code 500');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'content-length': String(64 * 1024 * 1024) } })));
    await expect(fetchFeed('https://example.org/feed.xml', 1000, publicLookup)).rejects.toThrow(/larger than/);
  });
});
