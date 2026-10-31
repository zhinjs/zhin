import { EventEmitter } from 'node:events';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
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
const endpointKey = capabilityId(rootPluginId(), adapterFeature, 'milky');
const gateway: OutboundMessageService = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
const httpStub = { ws: vi.fn(() => ({ onConnection: vi.fn(() => () => undefined) })), route: vi.fn(() => () => undefined) } as unknown as HttpHost;

function createSocket() {
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), ping: vi.fn(), close: vi.fn() });
  queueMicrotask(() => socket.emit('open')); return socket;
}

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
    expect(callApi).toHaveBeenCalledWith({ action: 'get_friend_list', signal: undefined });
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
    expect(callApi).toHaveBeenCalledWith({ action: 'get_group_list', signal: undefined });
  });

  it('群成员列表解包 data.members 并保持原生形状，gid 字符串收敛为数字', async () => {
    const members = [
      { user_id: 10001, nickname: 'Alice', role: 'owner' },
      { user_id: 10002, card: 'Bob卡' },
    ];
    const callApi = vi.fn(async () => ({ members }));
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listGroupMembers?.({ groupId: '20001' })).resolves.toEqual(members);
    expect(callApi).toHaveBeenCalledWith({ action: 'get_group_member_list', signal: undefined, params: { group_id: 20001 } });
  });

  it('非法 gid 抛 TypeError，不发起请求', async () => {
    const callApi = vi.fn();
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listGroupMembers?.({ groupId: 'abc' })).rejects.toBeInstanceOf(TypeError);
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
    await expect(management.listGroupMembers?.({ groupId: '1' })).rejects.toBe(failure);
  });

  it('缺字段/非数组响应归一为空数组', async () => {
    const callApi = vi.fn(async () => ({}));
    const management = createMilkyEndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([]);
    await expect(management.listGroups?.()).resolves.toEqual([]);
    await expect(management.listGroupMembers?.({ groupId: '1' })).resolves.toEqual([]);
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
      id: 'test-milky',
      baseUrl: 'http://127.0.0.1:3000',
    }) as MilkyWsConfig;
    const wssConfig = resolveMilkyConfig({
      connection: 'wss',
      id: 'test-milky',
      baseUrl: 'http://127.0.0.1:3000',
      path: '/milky',
    }) as MilkyWssConfig;
    const sseConfig = resolveMilkyConfig({
      connection: 'sse',
      id: 'test-milky',
      baseUrl: 'http://127.0.0.1:3000',
    }) as MilkySseConfig;
    const webhookConfig = resolveMilkyConfig({
      connection: 'webhook',
      id: 'test-milky',
      baseUrl: 'http://127.0.0.1:3000',
      path: '/milky/webhook',
    }) as MilkyWebhookConfig;

    const callApi = vi.fn(async () => ({ status: 'ok' as const, retcode: 0, data: { friends: [{ user_id: 10001, nickname: 'Alice' }] } }));
    const endpoints = [
      await createEndpointHarness(() => new MilkyWsEndpoint({ id: endpointKey, config: wsConfig, callApi, createWebSocket: createSocket }), { name: 'milky', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
      await createEndpointHarness(() => new MilkyWssEndpoint({ id: endpointKey, http: httpStub, config: wssConfig, callApi }), { name: 'milky', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
      await createEndpointHarness(() => new MilkySseEndpoint({ id: endpointKey, config: sseConfig, callApi, createSseStream: options => { queueMicrotask(() => options.onOpen?.()); return { closed: new Promise<void>(() => undefined), close() {} }; } }), { name: 'milky', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
      await createEndpointHarness(() => new MilkyWebhookEndpoint({ id: endpointKey, http: httpStub, config: webhookConfig, callApi }), { name: 'milky', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
    ];
    for (const endpoint of endpoints) {
      await endpoint.start(); endpoint.open();
      expect(listEndpointManagementCapabilities(endpoint.endpoint)).toEqual(expectedCapabilities);
      await expect(endpoint.index.management(endpoint.canonicalId)!.listFriends?.()).resolves.toEqual([
        { user_id: 10001, nickname: 'Alice', remark: '' },
      ]);
      expect(callApi).toHaveBeenCalledWith(expect.objectContaining({ action: 'get_friend_list', signal: expect.objectContaining({ aborted: false }) }));
      await endpoint.stop();
    }
  });
});
