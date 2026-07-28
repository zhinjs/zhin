import { describe, expect, it, vi } from 'vitest';
import { listEndpointManagementCapabilities } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createMilkyEndpointManagement } from '../src/endpoint-management.js';
import {
  resolveMilkyConfig,
  type MilkySseConfig,
  type MilkyWebhookConfig,
  type MilkyWsConfig,
  type MilkyWssConfig,
} from '../src/protocol.js';
import { MilkySseEndpoint } from '../src/sse-endpoint.js';
import { MilkyWebhookEndpoint } from '../src/webhook-endpoint.js';
import { MilkyWsEndpoint } from '../src/ws-endpoint.js';
import { MilkyWssEndpoint } from '../src/wss-endpoint.js';

const adapterFeature = featureId('zhin.adapter');
const endpointId = capabilityId(rootPluginId(), adapterFeature, 'milky');
const gateway: MessageGateway = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
const httpStub = { ws: vi.fn(), route: vi.fn() } as unknown as HttpHost;

const expectedCapabilities = ['listFriends', 'listGroups', 'listGroupMembers'];

describe('createMilkyEndpointManagement', () => {
  it('归一化好友列表（data.friends 解包，remark 缺省回退空串）', async () => {
    const callApi = vi.fn(async () => ({
      friends: [
        { user_id: 10001, nickname: 'Alice', remark: '同事', category: { id: 1, name: '默认' } },
        { user_id: 10002, nickname: 'Bob' },
      ],
    }));
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([
      { user_id: 10001, nickname: 'Alice', remark: '同事' },
      { user_id: 10002, nickname: 'Bob', remark: '' },
    ]);
    expect(callApi).toHaveBeenCalledWith('get_friend_list');
  });

  it('归一化群列表（data.groups 解包，group_name → name）', async () => {
    const callApi = vi.fn(async () => ({
      groups: [
        { group_id: 20001, group_name: '技术群', member_count: 3, max_member_count: 500 },
        { group_id: 20002, name: '备用名' },
      ],
    }));
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listGroups?.()).resolves.toEqual([
      { group_id: 20001, name: '技术群' },
      { group_id: 20002, name: '备用名' },
    ]);
    expect(callApi).toHaveBeenCalledWith('get_group_list');
  });

  it('群成员列表解包 data.members 并保持原生形状，gid 字符串收敛为数字', async () => {
    const members = [
      { user_id: 10001, nickname: 'Alice', role: 'owner' },
      { user_id: 10002, card: 'Bob卡' },
    ];
    const callApi = vi.fn(async () => ({ members }));
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listGroupMembers?.('20001')).resolves.toEqual(members);
    expect(callApi).toHaveBeenCalledWith('get_group_member_list', { group_id: 20001 });
  });

  it('非法 gid 抛 TypeError，不发起请求', async () => {
    const callApi = vi.fn();
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listGroupMembers?.('abc')).rejects.toBeInstanceOf(TypeError);
    expect(callApi).not.toHaveBeenCalled();
  });

  it('callApi 错误原样透传', async () => {
    const failure = new Error('Milky API get_friend_list: retcode=-1 未登录');
    const callApi = vi.fn(async () => {
      throw failure;
    });
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listFriends?.()).rejects.toBe(failure);
    await expect(management.listGroups?.()).rejects.toBe(failure);
    await expect(management.listGroupMembers?.('1')).rejects.toBe(failure);
  });

  it('缺字段/非数组响应归一为空数组', async () => {
    const callApi = vi.fn(async () => ({}));
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([]);
    await expect(management.listGroups?.()).resolves.toEqual([]);
    await expect(management.listGroupMembers?.('1')).resolves.toEqual([]);
  });

  it('能力按实现自动暴露（无 listChannels / 写操作）', () => {
    const management = createMilkyEndpointManagement({ callApi: vi.fn() });
    expect(listEndpointManagementCapabilities({ management })).toEqual(expectedCapabilities);
  });
});

describe('milky endpoint management wiring', () => {
  it('ws/wss/sse/webhook 四种传输都暴露 management 语义端口', async () => {
    const wsConfig = resolveMilkyConfig({
      connection: 'ws',
      name: 'test-milky',
      baseUrl: 'http://127.0.0.1:3000',
    }) as MilkyWsConfig;
    const wssConfig = resolveMilkyConfig({
      connection: 'wss',
      name: 'test-milky',
      baseUrl: 'http://127.0.0.1:3000',
      path: '/milky',
    }) as MilkyWssConfig;
    const sseConfig = resolveMilkyConfig({
      connection: 'sse',
      name: 'test-milky',
      baseUrl: 'http://127.0.0.1:3000',
    }) as MilkySseConfig;
    const webhookConfig = resolveMilkyConfig({
      connection: 'webhook',
      name: 'test-milky',
      baseUrl: 'http://127.0.0.1:3000',
      path: '/milky/webhook',
    }) as MilkyWebhookConfig;

    const endpoints = [
      new MilkyWsEndpoint({ id: endpointId, gateway, config: wsConfig }),
      new MilkyWssEndpoint({ id: endpointId, gateway, http: httpStub, config: wssConfig }),
      new MilkySseEndpoint({ id: endpointId, gateway, config: sseConfig }),
      new MilkyWebhookEndpoint({ id: endpointId, gateway, http: httpStub, config: webhookConfig }),
    ];
    for (const endpoint of endpoints) {
      expect(listEndpointManagementCapabilities(endpoint)).toEqual(expectedCapabilities);
      const callApi = vi.spyOn(endpoint, 'callApi').mockResolvedValue({
        friends: [{ user_id: 10001, nickname: 'Alice' }],
      });
      await expect(endpoint.management.listFriends?.()).resolves.toEqual([
        { user_id: 10001, nickname: 'Alice', remark: '' },
      ]);
      expect(callApi).toHaveBeenCalledWith('get_friend_list');
    }
  });
});
