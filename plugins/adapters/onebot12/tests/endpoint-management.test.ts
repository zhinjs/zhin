import { EventEmitter } from 'node:events';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { OneBotV12Client } from '@imhelper/onebot-v12';
import { describe, expect, it, vi } from 'vitest';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createOneBot12EndpointManagement } from '../src/endpoint-management.js';
import {
  resolveOneBot12Config,
  type OneBot12WebhookConfig,
  type OneBot12WsConfig,
  type OneBot12WssConfig,
} from '../src/protocol.js';
import { OneBot12WebhookEndpoint } from '../src/webhook.js';
import { OneBot12WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot12WssEndpoint } from '../src/wss-endpoint.js';

const adapterFeature = featureId('zhin.adapter');
const endpointKey = capabilityId(rootPluginId(), adapterFeature, 'onebot12');
const gateway: OutboundMessageService = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
const httpStub = { ws: vi.fn(() => ({ onConnection: vi.fn(() => () => undefined) })), route: vi.fn(() => () => undefined) } as unknown as HttpHost;

function createSocket() {
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), ping: vi.fn(), close: vi.fn() });
  queueMicrotask(() => socket.emit('open')); return socket;
}

const expectedCapabilities = ['listFriends', 'listGroups', 'listGroupMembers'];

describe('createOneBot12EndpointManagement', () => {
  it('归一化好友列表（OB12 user_name/user_displayname → nickname/remark，id 收敛为数字）', async () => {
    const callApi = vi.fn(async () => [
      { user_id: '10001', user_name: 'Alice', user_displayname: '同事' },
      { user_id: '10002', user_name: 'Bob' },
    ]);
    const management = createOneBot12EndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([
      { user_id: 10001, nickname: 'Alice', remark: '同事' },
      { user_id: 10002, nickname: 'Bob', remark: '' },
    ]);
    expect(callApi).toHaveBeenCalledWith('get_friend_list');
  });

  it('归一化群列表（group_name → name，兼容 name）', async () => {
    const callApi = vi.fn(async () => [
      { group_id: '20001', group_name: '技术群' },
      { group_id: '20002', name: '备用名' },
    ]);
    const management = createOneBot12EndpointManagement({ callApi });
    await expect(management.listGroups?.()).resolves.toEqual([
      { group_id: 20001, name: '技术群' },
      { group_id: 20002, name: '备用名' },
    ]);
    expect(callApi).toHaveBeenCalledWith('get_group_list');
  });

  it('群成员列表保持 OB12 原生形状，gid 按 OB12 字符串原样传递', async () => {
    const members = [
      { user_id: '10001', user_name: 'Alice' },
      { user_id: '10002', user_name: 'Bob' },
    ];
    const callApi = vi.fn(async () => members);
    const management = createOneBot12EndpointManagement({ callApi });
    await expect(management.listGroupMembers?.('20001')).resolves.toEqual(members);
    expect(callApi).toHaveBeenCalledWith('get_group_member_list', { group_id: '20001' });
  });

  it('callApi 错误原样透传', async () => {
    const failure = new Error('OneBot12 retcode=10001: bad self');
    const callApi = vi.fn(async () => {
      throw failure;
    });
    const management = createOneBot12EndpointManagement({ callApi });
    await expect(management.listFriends?.()).rejects.toBe(failure);
    await expect(management.listGroups?.()).rejects.toBe(failure);
    await expect(management.listGroupMembers?.('1')).rejects.toBe(failure);
  });

  it('非数组响应归一为空数组', async () => {
    const callApi = vi.fn(async () => ({ unexpected: true }));
    const management = createOneBot12EndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([]);
    await expect(management.listGroups?.()).resolves.toEqual([]);
    await expect(management.listGroupMembers?.('1')).resolves.toEqual([]);
  });

  it('能力按实现自动暴露（无 listChannels / 写操作）', () => {
    const management = createOneBot12EndpointManagement({ callApi: vi.fn() });
    expect(listEndpointManagementCapabilities({ management })).toEqual(expectedCapabilities);
  });
});

describe('onebot12 endpoint management wiring', () => {
  it('ws/wss 传输经公共 callApi 暴露 management', async () => {
    const wsConfig = resolveOneBot12Config({ platform: 'qq', userId: 'bot-1',
      connection: 'ws',
      id: 'test-ob12',
      url: 'ws://127.0.0.1:6701',
    }) as OneBot12WsConfig;
    const wssConfig = resolveOneBot12Config({ platform: 'qq', userId: 'bot-1',
      connection: 'wss',
      id: 'test-ob12',
      path: '/onebot12',
    }) as OneBot12WssConfig;

    const endpoints = [
      await createEndpointHarness(() => new OneBot12WsEndpoint({ id: endpointKey, config: wsConfig, createWebSocket: createSocket }), { name: 'onebot12', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
      await createEndpointHarness(() => new OneBot12WssEndpoint({ id: endpointKey, http: httpStub, config: wssConfig }), { name: 'onebot12', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
    ];
    for (const endpoint of endpoints) {
      await endpoint.start(); endpoint.open();
      expect(endpoint.endpoint).toBeInstanceOf(OneBotV12Client);
      expect(listEndpointManagementCapabilities(endpoint.endpoint)).toEqual(expectedCapabilities);
      const call = vi.spyOn(endpoint.endpoint, 'call').mockResolvedValue({
        status: 'ok',
        retcode: 0,
        data: [{ group_id: '20001', group_name: '技术群' }],
      });
      await expect(endpoint.index.management(endpoint.canonicalId)!.listGroups?.()).resolves.toEqual([
        { group_id: 20001, name: '技术群' },
      ]);
      expect(call).toHaveBeenCalledWith('get_group_list', undefined);
      await endpoint.stop();
    }
  });

  it('webhook 传输经 api_url + callAction 暴露 management', async () => {
    const config = resolveOneBot12Config({ platform: 'qq', userId: 'bot-1',
      connection: 'webhook',
      id: 'test-ob12',
      path: '/onebot12/webhook',
      api_url: 'http://127.0.0.1:5701',
    }) as OneBot12WebhookConfig;
    const callAction = vi.fn(async () => ({
      status: 'ok' as const,
      retcode: 0,
      message: '',
      data: [{ user_id: '10001', user_name: 'Alice' }],
    }));
    const endpoint = await createEndpointHarness(() => new OneBot12WebhookEndpoint({
      id: endpointKey,
      http: httpStub,
      config,
      callAction,
    }), { name: 'onebot12', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) });
    await endpoint.start(); endpoint.open();
    expect(listEndpointManagementCapabilities(endpoint.endpoint)).toEqual(expectedCapabilities);
    await expect(endpoint.index.management(endpoint.canonicalId)!.listFriends?.()).resolves.toEqual([
      { user_id: 10001, nickname: 'Alice', remark: '' },
    ]);
    expect(callAction).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:5701', access_token: undefined, self: { platform: 'qq', user_id: 'bot-1' } },
      'get_friend_list',
      {},
    );
    await endpoint.stop();
  });

  it('webhook 未配置 api_url 时在创建 endpoint 前拒绝配置', () => {
    expect(() => resolveOneBot12Config({ platform: 'qq', userId: 'bot-1',
      connection: 'webhook',
      id: 'test-ob12',
      path: '/onebot12/webhook',
    })).toThrow('non-empty api_url');
  });
});
