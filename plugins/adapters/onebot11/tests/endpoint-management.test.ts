import { describe, expect, it, vi } from 'vitest';
import { listEndpointManagementCapabilities } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createOneBot11EndpointManagement } from '../src/endpoint-management.js';
import {
  resolveOneBot11Config,
  type OneBot11WsConfig,
  type OneBot11WssConfig,
} from '../src/protocol.js';
import { OneBot11WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot11WssEndpoint } from '../src/wss-endpoint.js';

const adapterFeature = featureId('zhin.adapter');
const endpointId = capabilityId(rootPluginId(), adapterFeature, 'onebot11');
const gateway: MessageGateway = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
const httpStub = { ws: vi.fn(), route: vi.fn() } as unknown as HttpHost;

const expectedCapabilities = ['listFriends', 'listGroups', 'listGroupMembers'];

describe('createOneBot11EndpointManagement', () => {
  it('归一化好友列表（remark 缺省回退空串）', async () => {
    const callApi = vi.fn(async () => [
      { user_id: 10001, nickname: 'Alice', remark: '同事' },
      { user_id: 10002, nickname: 'Bob' },
    ]);
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([
      { user_id: 10001, nickname: 'Alice', remark: '同事' },
      { user_id: 10002, nickname: 'Bob', remark: '' },
    ]);
    expect(callApi).toHaveBeenCalledWith('get_friend_list');
  });

  it('归一化群列表（group_name → name，兼容 name）', async () => {
    const callApi = vi.fn(async () => [
      { group_id: 20001, group_name: '技术群', member_count: 3 },
      { group_id: 20002, name: '备用名' },
    ]);
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listGroups?.()).resolves.toEqual([
      { group_id: 20001, name: '技术群' },
      { group_id: 20002, name: '备用名' },
    ]);
    expect(callApi).toHaveBeenCalledWith('get_group_list');
  });

  it('群成员列表保持平台原生形状，gid 字符串收敛为数字', async () => {
    const members = [
      { user_id: 10001, nickname: 'Alice', role: 'owner' },
      { user_id: 10002, card: 'Bob卡' },
    ];
    const callApi = vi.fn(async () => members);
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listGroupMembers?.('20001')).resolves.toEqual(members);
    expect(callApi).toHaveBeenCalledWith('get_group_member_list', { group_id: 20001 });
  });

  it('非法 gid 抛 TypeError，不发起请求', async () => {
    const callApi = vi.fn();
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listGroupMembers?.('abc')).rejects.toBeInstanceOf(TypeError);
    expect(callApi).not.toHaveBeenCalled();
  });

  it('callApi 错误原样透传', async () => {
    const failure = new Error('OneBot11 retcode=100: 未登录');
    const callApi = vi.fn(async () => {
      throw failure;
    });
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listFriends?.()).rejects.toBe(failure);
    await expect(management.listGroups?.()).rejects.toBe(failure);
    await expect(management.listGroupMembers?.('1')).rejects.toBe(failure);
  });

  it('非数组响应归一为空数组', async () => {
    const callApi = vi.fn(async () => ({ unexpected: true }));
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([]);
    await expect(management.listGroups?.()).resolves.toEqual([]);
    await expect(management.listGroupMembers?.('1')).resolves.toEqual([]);
  });

  it('能力按实现自动暴露（无 listChannels / 写操作）', () => {
    const management = createOneBot11EndpointManagement({ callApi: vi.fn() });
    expect(listEndpointManagementCapabilities({ management })).toEqual(expectedCapabilities);
  });
});

describe('onebot11.endpoint management wiring', () => {
  it('ws/wss 两种传输都暴露 management 语义端口', async () => {
    const wsConfig = resolveOneBot11Config({
      connection: 'ws',
      name: 'test-ob11',
      url: 'ws://127.0.0.1:6700',
    }) as OneBot11WsConfig;
    const wssConfig = resolveOneBot11Config({
      connection: 'wss',
      name: 'test-ob11',
      path: '/onebot11',
    }) as OneBot11WssConfig;

    const endpoints = [
      new OneBot11WsEndpoint({ id: endpointId, gateway, config: wsConfig }),
      new OneBot11WssEndpoint({ id: endpointId, gateway, http: httpStub, config: wssConfig }),
    ];
    for (const endpoint of endpoints) {
      expect(listEndpointManagementCapabilities(endpoint)).toEqual(expectedCapabilities);
      const callApi = vi.spyOn(endpoint, 'callApi').mockResolvedValue([
        { user_id: 10001, nickname: 'Alice' },
      ]);
      await expect(endpoint.management.listFriends?.()).resolves.toEqual([
        { user_id: 10001, nickname: 'Alice', remark: '' },
      ]);
      expect(callApi).toHaveBeenCalledWith('get_friend_list');
    }
  });
});
