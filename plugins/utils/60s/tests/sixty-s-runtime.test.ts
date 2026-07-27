import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { fetchApi, formatList } from '../src/api.js';
import { DEFAULT_API_BASE, registerSixtySApiBase, resolveApiBase } from '../src/runtime-deps.js';
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

describe('60s runtime apiBase injection', () => {
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

  it('resolves apiBase at call time (config patch 生效)，unregister 后回落默认', async () => {
    const fetchMock = stubFetchOk();

    let base = 'https://a.example.com';
    const unregister = registerSixtySApiBase(() => base);
    await fetchApi('/x');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://a.example.com/v2/x');

    base = 'https://b.example.com';
    await fetchApi('/x');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://b.example.com/v2/x');

    unregister();
    expect(resolveApiBase()).toBe(DEFAULT_API_BASE);
    await fetchApi('/x');
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(`${DEFAULT_API_BASE}/v2/x`);
  });

  it('plugin setup 注册运行时 getter，lifecycle dispose 后恢复默认且不写 process.env', async () => {
    const fetchMock = stubFetchOk();
    const disposers: Array<() => void> = [];
    let cfg = { apiBase: 'https://cfg.example.com' };
    const context = {
      config: { get: () => cfg },
      lifecycle: { add: (d: () => void) => disposers.push(d) },
    };

    await (plugin as unknown as { setup: (ctx: unknown) => Promise<void> }).setup(context);
    expect(disposers).toHaveLength(1);
    expect(process.env.ZHIN_60S_API).toBeUndefined();

    await fetchApi('/y');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://cfg.example.com/v2/y');

    // config patch：getter 每次调用重新求值
    cfg = { apiBase: 'https://cfg2.example.com' };
    await fetchApi('/y');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://cfg2.example.com/v2/y');

    disposers.forEach((d) => d());
    expect(resolveApiBase()).toBe(DEFAULT_API_BASE);
  });
});
