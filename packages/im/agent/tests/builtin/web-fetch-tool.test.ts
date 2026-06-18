/**
 * web_fetch 内置工具（BuiltinBaseTool）单测 — fetch 全局 mock
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

import { setHostRootPlugin } from '../../../core/src/host-plugin-registry.js';
import type { Plugin, Message } from '@zhin.js/core';
import {
  createWebFetchTool,
  WebFetchBuiltinTool,
  stripFetchedHtmlToText,
} from '../../src/builtin/web-fetch-tool.js';
import { ZHIN_WEB_USER_AGENT } from '../../src/builtin/web-tool-utils.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { Message } from '@zhin.js/core';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setHostRootPlugin(null);
  vi.restoreAllMocks();
});

function mockPlugin(master = 'owner1', trusted: string[] = ['admin1'], execAllowlist: string[] = []) {
  const plugin = {
    inject: (name: string) => {
      if (name === 'icqq') {
        return { endpoints: new Map([['bot1', { $config: { master, trusted } }]]) };
      }
      if (name === 'ai') {
        return { getAgentConfig: () => ({ execAllowlist }) };
      }
      return undefined;
    },
  } as unknown as Plugin;
  (plugin as unknown as { root: Plugin }).root = plugin;
  setHostRootPlugin(plugin);
}

describe('WebFetchBuiltinTool', () => {
  it('SSRF：拒绝 localhost', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const inst = new WebFetchBuiltinTool();
    const out = String(await inst.run({ url: 'http://localhost:8080/' }));
    expect(out.startsWith('ZHIN_NEEDS_OWNER:\n')).toBe(true);
    expect(out).toContain('SSRF');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('SSRF：拒绝 127.0.0.1 与 172.16 私网', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const inst = new WebFetchBuiltinTool();
    const o1 = String(await inst.run({ url: 'http://127.0.0.1/' }));
    const o2 = String(await inst.run({ url: 'http://172.16.0.1/' }));
    expect(o1.startsWith('ZHIN_NEEDS_OWNER:\n')).toBe(true);
    expect(o2.startsWith('ZHIN_NEEDS_OWNER:\n')).toBe(true);
    expect(o1).toContain('SSRF');
    expect(o2).toContain('SSRF');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('非 http/https 协议拒绝', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const inst = new WebFetchBuiltinTool();
    const out = String(await inst.run({ url: 'file:///etc/passwd' }));
    expect(out).toContain('仅支持 http/https');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('成功抓取：UA、超时、redirect follow，并按 max_length 截断', async () => {
    const longBody = '<html><body><p>' + 'x'.repeat(100) + '</p></body></html>';
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://public.example/page');
      expect(init?.headers).toEqual({ 'User-Agent': ZHIN_WEB_USER_AGENT });
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(longBody, { status: 200, statusText: 'OK' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const inst = new WebFetchBuiltinTool();
    const out = String(await inst.run({ url: 'https://public.example/page', max_length: 30 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.endsWith('\n...(truncated)')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(30 + '\n...(truncated)'.length);
  });

  it('stripFetchedHtmlToText 去除 script/style 与标签', () => {
    const html = '<script>evil()</script><p>Hi&nbsp;<b>there</b></p>';
    expect(stripFetchedHtmlToText(html)).toBe('Hi there');
  });

  it('toTool 元数据与 execute 路径', async () => {
    mockPlugin('owner1', [], ['web_fetch']);
    vi.stubGlobal('fetch', async () => new Response('<html><body>OK</body></html>', { status: 200 }));
    const tool = createWebFetchTool();
    expect(tool.name).toBe('web_fetch');
    expect(tool.parameters.required).toContain('url');
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'owner1', sender_roles: ['master'] });
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ url: 'https://example.com/' });
    expect(String(result)).toContain('OK');
  });

  it('admin 且 web_fetch 不在 execAllowlist 时返回 ZHIN_NEEDS_OWNER', async () => {
    mockPlugin('owner1', ['admin1'], []);
    vi.stubGlobal('fetch', vi.fn());
    const inst = new WebFetchBuiltinTool();
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'admin1', sender_roles: ['trusted'] });
    const out = String(await inst.run({ url: 'https://example.com/' }, ctx));
    expect(out.startsWith('ZHIN_NEEDS_OWNER:\n')).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('普通用户调用 web_fetch 直接拒绝', async () => {
    mockPlugin('owner1', ['admin1'], []);
    vi.stubGlobal('fetch', vi.fn());
    const inst = new WebFetchBuiltinTool();
    const ctx = mockCommMessage({ adapter: 'icqq', endpoint: 'bot1', senderId: 'user1', sender_roles: ['user'] });
    const out = String(await inst.run({ url: 'https://example.com/' }, ctx));
    expect(out).toMatch(/^Error:/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
