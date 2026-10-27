import tool from '../skills/short-url/tools/short_url/index.js';
afterEach(() => vi.unstubAllGlobals());
it('uses the operation language for validation and provider-error wrappers', async () => {
  const context = { locale: 'en' } as never;
  expect(await tool.execute({ url: 'invalid' }, context)).toBe('Invalid URL; use http:// or https://');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
  expect(await tool.execute({ url: 'https://example.com' }, context)).toBe('Could not shorten the URL: is.gd returned HTTP 503');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ errormessage: '原始服务错误' }) })));
  expect(await tool.execute({ url: 'https://example.com' }, context)).toBe('Could not shorten the URL: 原始服务错误');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ shorturl: 'https://is.gd/fixture' }) })));
  expect(await tool.execute({ url: 'https://example.com' }, context)).toBe('https://is.gd/fixture');
});
