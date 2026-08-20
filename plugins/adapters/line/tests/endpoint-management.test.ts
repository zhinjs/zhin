import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js/plugin-runtime';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost } from '@zhin.js/host-http';
import { LineEndpoint, type LineFetch } from '../src/endpoint.js';
import { resolveLineConfig } from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveLineConfig({
  id: 'test-line-mgmt',
  channelSecret: 'sec',
  channelAccessToken: 'test-access-token',
  webhookPath: '/line/webhook',
  apiBaseUrl: 'https://api.line.me',
});

function gateway(): MessageGateway {
  return { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body), json: async () => body };
}

describe('line.endpoint management', () => {
  it('只暴露 listGroupMembers（Bot API 无群列表）', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway: gateway(),
      http,
      config: baseConfig,
      fetch: vi.fn(async () => jsonResponse({ memberIds: [] })) as unknown as LineFetch,
    });
    expect(listEndpointManagementCapabilities(endpoint)).toEqual(['listGroupMembers']);
    expect(endpoint.management.listGroups).toBeUndefined();
    expect(endpoint.management.listFriends).toBeUndefined();
    await http.close();
  });

  it('listGroupMembers：group members/ids 分页 + profile 归一 nickname', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/members/ids') && !String(url).includes('start=')) {
        return jsonResponse({ memberIds: ['U1'], next: 'cont-2' });
      }
      if (String(url).includes('/members/ids')) {
        return jsonResponse({ memberIds: ['U2'] });
      }
      if (String(url).endsWith('/member/U1')) return jsonResponse({ displayName: 'Alice' });
      if (String(url).endsWith('/member/U2')) return jsonResponse({}, false, 404);
      throw new Error(`unexpected url: ${url}`);
    });
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway: gateway(),
      http,
      config: baseConfig,
      fetch: fetchFn as unknown as LineFetch,
    });

    const members = await endpoint.management.listGroupMembers!('G123');

    expect(members).toEqual([
      { user_id: 'U1', nickname: 'Alice' },
      // profile 失败（用户已退群等）回退 userId 占位
      { user_id: 'U2', nickname: 'U2' },
    ]);
    expect(calls[0]).toBe('https://api.line.me/v2/bot/group/G123/members/ids');
    expect(calls[1]).toBe('https://api.line.me/v2/bot/group/G123/members/ids?start=cont-2');
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer test-access-token' },
    });
    await http.close();
  });

  it('listGroupMembers：R 前缀走 room API', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/members/ids')) return jsonResponse({ memberIds: ['U9'] });
      return jsonResponse({ displayName: 'Roomie' });
    });
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = new LineEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'line'),
      gateway: gateway(),
      http,
      config: baseConfig,
      fetch: fetchFn as unknown as LineFetch,
    });

    const members = await endpoint.management.listGroupMembers!('R999');

    expect(members).toEqual([{ user_id: 'U9', nickname: 'Roomie' }]);
    expect(calls[0]).toBe('https://api.line.me/v2/bot/room/R999/members/ids');
    await http.close();
  });
});
