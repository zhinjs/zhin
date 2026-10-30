import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import { createHttpHost } from '@zhin.js/host-http';
import { WeChatMpEndpoint } from '../src/endpoint.js';
import type { WeChatMpFetch } from '../src/client.js';
import { resolveWeChatMpConfig } from '../src/protocol.js';

const harnesses: Awaited<ReturnType<typeof createEndpointHarness>>[] = [];
afterEach(async () => { await Promise.all(harnesses.splice(0).map(harness => harness.stop())); });

const adapterFeature = featureId('zhin.adapter');

function gateway(): OutboundMessageService {
  return { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') };
}

function config() {
  return resolveWeChatMpConfig({
    id: 'mgmt-bot',
    appId: 'wx-app',
    appSecret: 'sec',
    token: 'tok',
    encrypt: false,
  });
}

describe('wechat-mp endpoint management', () => {
  it('只暴露 listFriends（公众号无群/频道概念）', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = await createEndpointHarness(() => new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: gateway(),
      http,
      config: config(),
      fetch: vi.fn(async () => ({ data: { access_token: 'synthetic-token', expires_in: 7200 } })) as unknown as WeChatMpFetch,
    }), { gateway: createTestEventGateway(gateway(), undefined), capabilities: ['inbound', 'outbound'] });
    await endpoint.start(); endpoint.open(); harnesses.push(endpoint);
    expect(listEndpointManagementCapabilities({ management: endpoint.index.management(endpoint.canonicalId) })).toEqual(['listFriends']);
    expect(endpoint.index.management(endpoint.canonicalId).listGroups).toBeUndefined();
    expect(endpoint.index.management(endpoint.canonicalId).listGroupMembers).toBeUndefined();
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
    const endpoint = await createEndpointHarness(() => new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: gateway(),
      http,
      config: config(),
      fetch: fetchFn as unknown as WeChatMpFetch,
    }), { gateway: createTestEventGateway(gateway(), undefined), capabilities: ['inbound', 'outbound'] });
    await endpoint.start(); endpoint.open(); harnesses.push(endpoint);

    const friends = await endpoint.index.management(endpoint.canonicalId).listFriends!();

    expect(friends).toEqual([
      { user_id: 'oA', nickname: 'oA', remark: '' },
      { user_id: 'oB', nickname: 'oB', remark: '' },
    ]);
    // 先刷 token，再带 access_token 拉关注者
    expect(urls[0]).toContain('/cgi-bin/token');
    const followerUrl = new URL(urls[1]!);
    expect(followerUrl.pathname).toBe('/cgi-bin/user/get');
    expect(followerUrl.searchParams.get('access_token')).toBe('tok-1');
    expect(followerUrl.searchParams.get('next_openid')).toBe('');
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
    const endpoint = await createEndpointHarness(() => new WeChatMpEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'wechat-mp'),
      gateway: gateway(),
      http,
      config: config(),
      fetch: fetchFn as unknown as WeChatMpFetch,
    }), { gateway: createTestEventGateway(gateway(), undefined), capabilities: ['inbound', 'outbound'] });
    await endpoint.start(); endpoint.open(); harnesses.push(endpoint);

    await expect(endpoint.index.management(endpoint.canonicalId).listFriends!()).rejects.toThrow(/48001/);
    await http.close();
  });
});
