import { describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../schema.json' with { type: 'json' };
import { parseCommandDefinition } from 'zhin.js/command';
import { pluginConsoleRpcToken } from 'zhin.js';
import plugin from '../plugin.ts';
import shortenCommand from '../commands/shorten/[url]/index.ts';
import expandCommand from '../commands/expand/[url]/index.ts';
import { expandUrl, isValidUrl } from '../src/short-url-lib.js';

describe('@zhin.js/plugin-short-url', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('short-url');
  });

  it('publishes an empty strict static schema without a duplicate runtime declaration', () => {
    const validate = new Ajv2020({ useDefaults: true, strict: true }).compile(schema);
    expect(validate({})).toBe(true);
    expect(validate({ apiKey: 'unused' })).toBe(false);
    expect(schema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    expect(plugin.config).toBeUndefined();
  });

  it('brands shorten and expand commands', () => {
    expect(parseCommandDefinition(shortenCommand)).toBe(shortenCommand);
    expect(parseCommandDefinition(expandCommand)).toBe(expandCommand);
  });

  it('validates http(s) urls', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  it('rejects invalid url in shorten command', async () => {
    const result = await shortenCommand.execute({
      owner: {} as never,
      generation: 0,
      config: {},
      use: () => {
        throw new Error('unused');
      },
      args: [],
      params: { url: 'bad' },
      input: undefined,
    });
    expect(result).toBe('请提供有效的 HTTP/HTTPS 链接');
  });

  const publicLookup = async () => ['93.184.216.34'];

  it('expands a short url by following redirects hop by hop', async () => {
    const fetchMock = vi.fn(async (url: string) => url === 'https://is.gd/abc'
      ? new Response(null, { status: 301, headers: { location: 'https://example.com/landing' } })
      : new Response('body that is never read'));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(expandUrl('https://is.gd/abc', 'zh-CN', publicLookup)).resolves.toBe('https://example.com/landing');
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://is.gd/abc', 'https://example.com/landing']);
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns the original url when no redirect happens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    try {
      await expect(expandUrl('https://example.com/page', 'zh-CN', publicLookup)).resolves.toBe('https://example.com/page');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when the final response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    try {
      await expect(expandUrl('https://example.com/page', 'zh-CN', publicLookup)).rejects.toThrow('无法展开链接 (404)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never requests an internal address, directly or through a redirect', async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(expandUrl('http://127.0.0.1:8080/admin')).rejects.toThrow(/refusing to fetch/);
      await expect(expandUrl('http://localhost/')).rejects.toThrow(/refusing to fetch/);
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(expandUrl('https://is.gd/abc', 'zh-CN', publicLookup)).rejects.toThrow(/refusing to fetch/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The expand command reports the refusal instead of throwing.
      const reply = await expandCommand.execute({
        owner: {} as never, generation: 0, config: {}, locale: 'zh-CN',
        use: () => { throw new Error('unused'); },
        args: [], params: { url: 'http://10.0.0.5/' }, input: undefined,
      } as never);
      expect(String(reply)).toContain('展开失败');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('@zhin.js/plugin-short-url Console actions', () => {
  type Method = { handler: (input: unknown, call: unknown) => any };
  type Rpc = { methods: ReadonlyMap<string, Method> };
  async function consoleRpc(): Promise<Rpc> {
    let provided: Rpc | undefined;
    await (plugin as unknown as { setup: (context: unknown) => unknown }).setup({
      resources: { provide: (token: unknown, value: Rpc) => { if (token === pluginConsoleRpcToken) provided = value; } },
      lifecycle: { add: () => undefined },
    });
    return provided!;
  }
  const invoke = (rpc: Rpc, name: string, input: unknown = {}) => rpc.methods.get(name)!.handler(input, {});

  it('create calls the real shortener and stores the link it returns', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ shorturl: 'https://is.gd/Xy12Ab' })));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const rpc = await consoleRpc();
      // A caller-supplied code is ignored: the service decides the code.
      const created = await invoke(rpc, 'create', { url: ' https://example.com/a?b=1 ', code: 'mine' });
      expect(created).toMatchObject({ code: 'Xy12Ab', shortUrl: 'https://is.gd/Xy12Ab', url: 'https://example.com/a?b=1' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [api, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(api).toBe(`https://is.gd/create.php?format=json&url=${encodeURIComponent('https://example.com/a?b=1')}`);
      expect(init.signal).toBeInstanceOf(AbortSignal);

      const status = await invoke(rpc, 'status');
      expect(status.totalCount).toBe(1);
      expect(status).not.toHaveProperty('totalClicks');
      expect(status.items[0]).toMatchObject({ code: 'Xy12Ab', shortUrl: 'https://is.gd/Xy12Ab' });
      expect(status.items[0]).not.toHaveProperty('clicks');

      expect(await invoke(rpc, 'remove', { code: 'Xy12Ab' })).toMatchObject({ ok: true });
      expect((await invoke(rpc, 'status')).totalCount).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('create records nothing when the service fails or the URL is invalid', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const rpc = await consoleRpc();
      await expect(invoke(rpc, 'create', { url: 'https://example.com' })).rejects.toThrow(/缩短失败: is\.gd 返回 503/);
      await expect(invoke(rpc, 'create', { url: 'ftp://example.com' })).rejects.toThrow('请提供有效的 HTTP/HTTPS 链接');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await invoke(rpc, 'status')).totalCount).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the page offers no custom code field and no click counter', async () => {
    const page = (await import('../pages/index/index.ts')).default as unknown as () => unknown;
    const blueprint = JSON.stringify(page());
    expect(blueprint).toContain('totalCount');
    expect(blueprint).toContain('shortUrl');
    expect(blueprint).not.toMatch(/clicks|totalClicks|Custom Code|自定义短码/i);
  });
});
