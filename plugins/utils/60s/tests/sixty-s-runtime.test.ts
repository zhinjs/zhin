import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { formatList } from '../src/api.js';
import { DEFAULT_API_BASE, SixtySClient, sixtySClientToken } from '../src/client.js';
import plugin from '../plugin.ts';
import weatherTool from '../agent/tools/$weather.ts';
import newsTool from '../agent/tools/$60s_news.ts';
import weatherCommand from '../commands/weather/$[city].ts';
import newsCommand from '../commands/$60s.ts';

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

  it('routes command and Agent Tool execution through the invoking owner client', async () => {
    const client = {
      fetch: vi.fn().mockResolvedValue({
        weather: {temperature: 20, condition: '晴', humidity: 30},
        air_quality: {},
        location: {city: '北京'},
      }),
    } as unknown as SixtySClient;
    const use = vi.fn((token: {id: string}) => {
      expect(token).toBe(sixtySClientToken);
      return client;
    });

    await weatherCommand.execute({params: {city: '北京'}, use} as never);
    await weatherTool.execute({city: '北京'}, {use} as never);

    expect(use).toHaveBeenCalledTimes(2);
    expect(client.fetch).toHaveBeenCalledTimes(2);
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

    const data = await new SixtySClient(() => undefined).fetch<{ hello: string }>('/test');
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
    await expect(new SixtySClient(() => undefined).fetch('/test')).rejects.toThrow('502 Bad Gateway');
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
    await expect(new SixtySClient(() => undefined).fetch('/test')).rejects.toThrow('非 JSON');
  });

  it('wraps network failures into readable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }));
    await expect(new SixtySClient(() => undefined).fetch('/test'))
      .rejects.toThrow('请求失败: getaddrinfo ENOTFOUND');
  });

  it('wraps timeouts into readable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('The operation timed out.');
      err.name = 'TimeoutError';
      throw err;
    }));
    await expect(new SixtySClient(() => undefined).fetch('/test')).rejects.toThrow('请求超时（30s）');
  });
});

describe('60s owner-scoped client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchOk() {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
      json: async () => ({ code: 200, data: {} }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('resolves apiBase at call time so config patches take effect', async () => {
    const fetchMock = stubFetchOk();

    let base = 'https://a.example.com';
    const client = new SixtySClient(() => base);
    await client.fetch('/x');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://a.example.com/v2/x');

    base = 'https://b.example.com';
    await client.fetch('/x');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://b.example.com/v2/x');

    base = '';
    expect(client.apiBase).toBe(DEFAULT_API_BASE);
    await client.fetch('/x');
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(`${DEFAULT_API_BASE}/v2/x`);
  });

  it('plugin setup provides an isolated client owned by its resource scope', async () => {
    const fetchMock = stubFetchOk();
    let cfg = { apiBase: 'https://cfg.example.com' };
    const resources = new Map<string, unknown>();
    const context = {
      config: { get: () => cfg },
      resources: {
        provide: (token: {id: string}, value: unknown) => resources.set(token.id, value),
      },
    };

    await (plugin as unknown as { setup: (ctx: unknown) => Promise<void> }).setup(context);
    expect(process.env.ZHIN_60S_API).toBeUndefined();
    const client = resources.get(sixtySClientToken.id) as SixtySClient;
    expect(client).toBeInstanceOf(SixtySClient);

    await client.fetch('/y');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://cfg.example.com/v2/y');

    // config patch：getter 每次调用重新求值
    cfg = { apiBase: 'https://cfg2.example.com' };
    await client.fetch('/y');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://cfg2.example.com/v2/y');
  });

  it('keeps concurrent plugin instances isolated', () => {
    const first = new SixtySClient(() => 'https://first.example.com');
    const second = new SixtySClient(() => 'https://second.example.com');
    expect(first.apiBase).toBe('https://first.example.com');
    expect(second.apiBase).toBe('https://second.example.com');
  });
});
