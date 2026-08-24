import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { HttpHost } from '@zhin.js/host-http';
import { LarkEndpoint, type LarkFetch } from '../src/endpoint.js';
import { resolveLarkConfig } from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveLarkConfig({
  id: 'test-lark-bot',
  appId: 'cli_test',
  appSecret: 'secret-test',
  webhookPath: '/lark/webhook',
  apiBaseUrl: 'https://open.feishu.cn/open-apis',
  isFeishu: true,
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/** token 端点固定放行，其余 URL 交给 handler 分发。 */
function mockLarkApi(
  handler: (url: string) => { code: number; msg?: string; data?: Record<string, unknown> },
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'tok', expire: 7200 });
    }
    return jsonResponse(handler(String(url)));
  });
}

function createEndpoint(fetch: LarkFetch): LarkEndpoint {
  return bindTestEndpoint(new LarkEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'lark'),
    gateway: {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    },
    // management 只走 OpenAPI，不触碰 HttpHost；start() 才会注册路由。
    http: {} as HttpHost,
    config: baseConfig,
    fetch,
  }), {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    }, undefined);
}

describe('lark.endpoint management', () => {
  it('advertises only listGroups/listGroupMembers and keeps the port frozen', () => {
    const endpoint = createEndpoint(mockLarkApi(() => ({ code: 0, data: { items: [] } })));
    expect(Object.isFrozen(endpoint.management)).toBe(true);
    expect(listEndpointManagementCapabilities(endpoint)).toEqual([
      'listGroups',
      'listGroupMembers',
    ]);
    expect(endpoint.management.listFriends).toBeUndefined();
    expect(endpoint.management.listChannels).toBeUndefined();
    expect(endpoint.management.kickGroupMember).toBeUndefined();
  });

  it('listGroups paginates /im/v1/chats and normalizes chat_id/name', async () => {
    const seen: string[] = [];
    const fetchMock = mockLarkApi((url) => {
      seen.push(url);
      if (url.includes('page_token=p2')) {
        return { code: 0, data: { items: [{ chat_id: 'oc_2' }], has_more: false } };
      }
      return {
        code: 0,
        data: {
          items: [{ chat_id: 'oc_1', name: '产品一群' }, { name: '缺 id 应被丢弃' }],
          has_more: true,
          page_token: 'p2',
        },
      };
    });
    const endpoint = createEndpoint(fetchMock as unknown as LarkFetch);

    const groups = await endpoint.management.listGroups!();

    expect(groups).toEqual([
      { group_id: 'oc_1', name: '产品一群' },
      { group_id: 'oc_2', name: 'oc_2' },
    ]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('/im/v1/chats?');
    expect(seen[0]).toContain('page_size=100');
    expect(seen[1]).toContain('page_token=p2');
  });

  it('listGroupMembers passes member_id_type and returns platform-shaped rows', async () => {
    const member = { member_id: 'ou_1', member_id_type: 'open_id', name: 'Tom', tenant_key: 't' };
    const seen: string[] = [];
    const fetchMock = mockLarkApi((url) => {
      seen.push(url);
      return { code: 0, data: { items: [member], has_more: false } };
    });
    const endpoint = createEndpoint(fetchMock as unknown as LarkFetch);

    const members = await endpoint.management.listGroupMembers!('oc_1');

    expect(members).toEqual([member]);
    expect(seen[0]).toContain('/im/v1/chats/oc_1/members');
    expect(seen[0]).toContain('member_id_type=open_id');
  });

  it('propagates OpenAPI errors so the RPC layer can surface them', async () => {
    const endpoint = createEndpoint(
      mockLarkApi(() => ({ code: 99991663, msg: 'token invalid' })) as unknown as LarkFetch,
    );
    await expect(endpoint.management.listGroups!()).rejects.toThrow(/token invalid/);
  });
});
