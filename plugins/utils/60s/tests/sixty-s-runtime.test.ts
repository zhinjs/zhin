import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { fetchApi, formatList } from '../src/api.js';
import plugin from '../plugin.ts';
import weatherTool from '../agent/tools/weather.ts';
import newsTool from '../agent/tools/60s_news.ts';
import weatherCommand from '../commands/weather/[city:string].ts';
import newsCommand from '../commands/60s.ts';

describe('@zhin.js/plugin-60s', () => {
  it('defines Plugin Runtime entry as sixty-s', () => {
    expect(plugin.name).toBe('sixty-s');
  });

  it('exposes agent tools via defineAgentTool authoring surface', () => {
    // Canonical tool definitions live under agent/tools/ (tags/keywords per README);
    // there is no duplicate top-level tools/ directory.
    expect(typeof weatherTool.execute).toBe('function');
    expect(typeof newsTool.execute).toBe('function');
    expect(weatherTool.description).toContain('天气');
    expect(weatherTool.keywords).toContain('weather');
  });

  it('exposes chat commands', () => {
    expect(parseCommandDefinition(weatherCommand)).toBe(weatherCommand);
    expect(parseCommandDefinition(newsCommand)).toBe(newsCommand);
  });

  it('formats hot lists', () => {
    const result = formatList([
      { title: '热搜1', hot: '100万' },
      { title: '热搜2', hot: '50万' },
    ]);
    expect(result).toContain('1. 热搜1');
    expect(result).toContain('🔥100万');
    expect(formatList([], 5)).toBe('');
  });
});

describe('fetchApi guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes a 30s timeout signal to fetch', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
      json: async () => ({ code: 200, data: { hello: 'world' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchApi<{ hello: string }>('/test');
    expect(data.hello).toBe('world');
    const options = fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);
  });

  it('rejects non-ok responses with status text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: { get: () => 'text/html' },
    })));
    await expect(fetchApi('/test')).rejects.toThrow('502 Bad Gateway');
  });

  it('rejects HTML error pages instead of crashing on res.json()', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html; charset=utf-8' : null) },
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    })));
    await expect(fetchApi('/test')).rejects.toThrow('非 JSON');
  });

  it('wraps network failures into readable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }));
    await expect(fetchApi('/test')).rejects.toThrow('请求失败: getaddrinfo ENOTFOUND');
  });

  it('wraps timeouts into readable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('The operation timed out.');
      err.name = 'TimeoutError';
      throw err;
    }));
    await expect(fetchApi('/test')).rejects.toThrow('请求超时（30s）');
  });
});
