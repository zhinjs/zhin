import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { listEndpointManagementCapabilities } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost } from '@zhin.js/host-http';
import { WeChatMpEndpoint, type WeChatMpFetch } from '../src/endpoint.js';
import { resolveWeChatMpConfig } from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

function gateway(): MessageGateway {
  return { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') };
}

function config() {
  return resolveWeChatMpConfig({
    name: 'mgmt-bot',
    appId: 'wx-app',
    appSecret: 'sec',
    token: 'tok',
    encrypt: false,
  });
}

describe('wechat-mp.endpoint management', () => {
  it('只暴露 listFriends（公众号无群/频道概念）', () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: gateway(),
      http,
      config: config(),
      fetch: vi.fn(async () => ({ data: {} })) as unknown as WeChatMpFetch,
    });
    expect(listEndpointManagementCapabilities(endpoint)).toEqual(['listFriends']);
    expect(endpoint.management.listGroups).toBeUndefined();
    expect(endpoint.management.listGroupMembers).toBeUndefined();
    return http.close();
  });

  it('listFriends：GET /cgi-bin/user/get openid 列表，nickname 用 openid 占位', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('/cgi-bin/token')) {
        return { data: { access_token: 'tok-1', expires_in: 7200 } };
      }
      return {
        data: { total: 2, count: 2, data: { openid: ['oA', 'oB'] }, next_openid: 'oB' },
      };
    });
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: gateway(),
      http,
      config: config(),
      fetch: fetchFn as unknown as WeChatMpFetch,
    });

    const friends = await endpoint.management.listFriends!();

    expect(friends).toEqual([
      { user_id: 'oA', nickname: 'oA', remark: '' },
      { user_id: 'oB', nickname: 'oB', remark: '' },
    ]);
    // 先刷 token，再带 access_token 拉关注者
    expect(urls[0]).toContain('/cgi-bin/token');
    expect(urls[1]).toContain('/cgi-bin/user/get?access_token=tok-1');
    await http.close();
  });

  it('listFriends：关注者接口报错时抛错', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('/cgi-bin/token')) {
        return { data: { access_token: 'tok-1', expires_in: 7200 } };
      }
      return { data: { errcode: 48001, errmsg: 'api unauthorized' } };
    });
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: gateway(),
      http,
      config: config(),
      fetch: fetchFn as unknown as WeChatMpFetch,
    });

    await expect(endpoint.management.listFriends!()).rejects.toThrow(/48001/);
    await http.close();
  });
});
