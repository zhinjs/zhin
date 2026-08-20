import { describe, expect, it, vi } from 'vitest';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js/plugin-runtime';
import { createNapCatEndpointManagement } from '../src/endpoint-management.js';
import { NapCatHttpEndpoint } from '../src/http-endpoint.js';
import {
  resolveNapCatConfig,
  type NapCatHttpConfig,
  type NapCatWsConfig,
  type NapCatWssConfig,
} from '../src/protocol.js';
import { NapCatWsEndpoint } from '../src/ws-endpoint.js';
import { NapCatWssEndpoint } from '../src/wss-endpoint.js';

const adapterFeature = featureId('zhin.adapter');
const endpointKey = capabilityId(rootPluginId(), adapterFeature, 'napcat');
const gateway: MessageGateway = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
const httpStub = { ws: vi.fn(), route: vi.fn() } as unknown as HttpHost;

const expectedCapabilities = ['listFriends', 'listGroups', 'listGroupMembers'];

describe('createNapCatEndpointManagement', () => {
  it('归一化好友列表（remark 缺省回退空串）', async () => {
    const callApi = vi.fn(async () => [
      { user_id: 10001, nickname: 'Alice', remark: '同事' },
      { user_id: 10002, nickname: 'Bob' },
    ]);
    const management = createNapCatEndpointManagement({ callApi });
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
    const management = createNapCatEndpointManagement({ callApi });
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
    const management = createNapCatEndpointManagement({ callApi });
    await expect(management.listGroupMembers?.('20001')).resolves.toEqual(members);
    expect(callApi).toHaveBeenCalledWith('get_group_member_list', { group_id: 20001 });
  });

  it('非法 gid 抛 TypeError，不发起请求', async () => {
    const callApi = vi.fn();
    const management = createNapCatEndpointManagement({ callApi });
    await expect(management.listGroupMembers?.('abc')).rejects.toBeInstanceOf(TypeError);
    expect(callApi).not.toHaveBeenCalled();
  });

  it('callApi 错误原样透传', async () => {
    const failure = new Error('NapCat retcode=100: 未登录');
    const callApi = vi.fn(async () => {
      throw failure;
    });
    const management = createNapCatEndpointManagement({ callApi });
    await expect(management.listFriends?.()).rejects.toBe(failure);
    await expect(management.listGroups?.()).rejects.toBe(failure);
    await expect(management.listGroupMembers?.('1')).rejects.toBe(failure);
  });

  it('非数组响应归一为空数组', async () => {
    const callApi = vi.fn(async () => ({ unexpected: true }));
    const management = createNapCatEndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([]);
    await expect(management.listGroups?.()).resolves.toEqual([]);
    await expect(management.listGroupMembers?.('1')).resolves.toEqual([]);
  });

  it('能力按实现自动暴露（无 listChannels / 写操作）', () => {
    const management = createNapCatEndpointManagement({ callApi: vi.fn() });
    expect(listEndpointManagementCapabilities({ management })).toEqual(expectedCapabilities);
  });
});

describe('napcat.endpoint management wiring', () => {
  it('ws/wss/http 三种传输都暴露 management 语义端口', async () => {
    const wsConfig = resolveNapCatConfig({
      connection: 'ws',
      id: 'test-napcat',
      url: 'ws://127.0.0.1:3001',
    }) as NapCatWsConfig;
    const wssConfig = resolveNapCatConfig({
      connection: 'wss',
      id: 'test-napcat',
      path: '/napcat',
    }) as NapCatWssConfig;
    const httpConfig = resolveNapCatConfig({
      connection: 'http',
      id: 'test-napcat',
      http_url: 'http://127.0.0.1:3000',
      post_path: '/napcat/post',
    }) as NapCatHttpConfig;

    const endpoints = [
      new NapCatWsEndpoint({ id: endpointKey, gateway, config: wsConfig }),
      new NapCatWssEndpoint({ id: endpointKey, gateway, http: httpStub, config: wssConfig }),
      new NapCatHttpEndpoint({ id: endpointKey, gateway, http: httpStub, config: httpConfig }),
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
