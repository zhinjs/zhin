/**
 * web_search 内置工具（BuiltinBaseTool）单测 — fetch 全局 mock
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createWebSearchTool,
  WebSearchBuiltinTool,
  MAX_WEB_SEARCH_COUNT,
} from '../../src/builtin/web-search-tool.js';
import {
  bingSearchFetchHeaders,
  buildBingSearchUrl,
} from '../../src/builtin/bing-search-html.js';
import { DEFAULT_WEB_SEARCH_MARKET } from '../../src/builtin/web-search-locale.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function bingResultHtml(): string {
  return (
    '<html><body><ol id="b_results">' +
    '<li class="b_algo">' +
    '<h2><a href="https://github.com/zhinjs/zhin">Repo <b>Title</b></a></h2>' +
    '<p class="b_lineclamp_2">Snippet <em>text</em> here</p>' +
    '</li>' +
    '<li class="b_algo">' +
    '<h2><a href="https://example.com/direct">Direct</a></h2>' +
    '</li>' +
    '</ol></body></html>'
  );
}

describe('WebSearchBuiltinTool', () => {
  it('toTool 元数据与 Bing 请求头、超时与 URL', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(buildBingSearchUrl('zhin js', DEFAULT_WEB_SEARCH_MARKET));
      const expectedHeaders = bingSearchFetchHeaders(DEFAULT_WEB_SEARCH_MARKET);
      expect(init?.headers).toMatchObject({
        'User-Agent': expectedHeaders['User-Agent'],
        Accept: expectedHeaders.Accept,
        'Accept-Language': expectedHeaders['Accept-Language'],
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(bingResultHtml(), { status: 200, statusText: 'OK' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tool = createWebSearchTool();
    expect(tool.name).toBe('web_search');
    expect(tool.description).toContain('Bing');
    expect(tool.parameters.required).toContain('query');
    expect(tool.source).toBe('builtin:agent');
    expect(tool.tags).toContain('web');

    const inst = new WebSearchBuiltinTool();
    const out = String(await inst.run({ query: 'zhin js', limit: 5 }, undefined));
    expect(fetchMock).toHaveBeenCalled();
    expect(out).toContain('(1/');
    expect(out).toContain('Repo Title');
    expect(out).toContain('https://github.com/zhinjs/zhin');
    expect(out).toContain('Snippet text here');
    expect(out).toContain('Direct');
    expect(out).toContain('https://example.com/direct');
  });

  it('ToolContext.extra.web_search_locale 覆盖默认 Bing 市场', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain('setmkt=en-US');
      expect((init?.headers as Record<string, string>)['Accept-Language']).toMatch(/en-US/i);
      return new Response(bingResultHtml(), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const inst = new WebSearchBuiltinTool();
    await inst.run(
      { query: 'x', limit: 2 },
      { platform: 'test', extra: { web_search_locale: 'en' } } as ToolContext,
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('allowed_domains 仅保留指定主机名（含子域）', async () => {
    vi.stubGlobal('fetch', async () => new Response(bingResultHtml(), { status: 200 }));
    const inst = new WebSearchBuiltinTool();
    const out = String(
      await inst.run({
        query: 'x',
        limit: 10,
        allowed_domains: ['github.com'],
      }),
    );
    expect(out).toContain('github.com');
    expect(out).not.toContain('example.com');
  });

  it('超过 MAX_WEB_SEARCH_COUNT 后拒绝', async () => {
    vi.stubGlobal('fetch', async () => new Response(bingResultHtml(), { status: 200 }));
    const inst = new WebSearchBuiltinTool();
    for (let i = 0; i < MAX_WEB_SEARCH_COUNT; i++) {
      await inst.run({ query: `q${i}` });
    }
    const blocked = String(await inst.run({ query: 'one more' }));
    expect(blocked).toContain('搜索次数已达上限');
  });

  it('execute 经 normalizeTool 绑定 context 可调用', async () => {
    vi.stubGlobal('fetch', async () => new Response(bingResultHtml(), { status: 200 }));
    const tool = createWebSearchTool();
    const ctx = { platform: 'test' } as ToolContext;
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ query: 'test' });
    expect(String(result)).toContain('Repo Title');
  });
});
