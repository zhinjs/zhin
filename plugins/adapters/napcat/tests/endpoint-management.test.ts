import { EventEmitter } from 'node:events';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
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
const gateway: OutboundMessageService = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
const httpStub = { ws: vi.fn(() => ({ onConnection: vi.fn(() => () => undefined) })), route: vi.fn(() => () => undefined) } as unknown as HttpHost;

function createSocket() {
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), ping: vi.fn(), close: vi.fn() });
  queueMicrotask(() => socket.emit('open')); return socket;
}

const expectedCapabilities = ['listFriends', 'listGroups', 'listGroupMembers'];

describe('createNapCatEndpointManagement', () => {
  it('发群公告走 _send_group_notice（宿主内部，不进 Console 能力列表）', async () => {
    const requestApi = vi.fn(async () => null);
    const management = createNapCatEndpointManagement({ requestApi });
    await management.sendGroupNotice?.({ groupId: '20001', content: '周六活动' });
    expect(requestApi).toHaveBeenCalledWith({ action: '_send_group_notice', params: { group_id: 20001, content: '周六活动' }, signal: undefined });
  });

  it('归一化好友列表（remark 缺省回退空串）', async () => {
    const requestApi = vi.fn(async () => [
      { user_id: 10001, nickname: 'Alice', remark: '同事' },
      { user_id: 10002, nickname: 'Bob' },
    ]);
    const management = createNapCatEndpointManagement({ requestApi });
    await expect(management.listFriends?.()).resolves.toEqual([
      { user_id: 10001, nickname: 'Alice', remark: '同事' },
      { user_id: 10002, nickname: 'Bob', remark: '' },
    ]);
    expect(requestApi).toHaveBeenCalledWith({ action: 'get_friend_list', signal: undefined });
  });

  it('归一化群列表（group_name → name，兼容 name）', async () => {
    const requestApi = vi.fn(async () => [
      { group_id: 20001, group_name: '技术群', member_count: 3 },
      { group_id: 20002, name: '备用名' },
    ]);
    const management = createNapCatEndpointManagement({ requestApi });
    await expect(management.listGroups?.()).resolves.toEqual([
      { group_id: 20001, name: '技术群' },
      { group_id: 20002, name: '备用名' },
    ]);
    expect(requestApi).toHaveBeenCalledWith({ action: 'get_group_list', signal: undefined });
  });

  it('群成员列表保持平台原生形状，gid 字符串收敛为数字', async () => {
    const members = [
      { user_id: 10001, nickname: 'Alice', role: 'owner' },
      { user_id: 10002, card: 'Bob卡' },
    ];
    const requestApi = vi.fn(async () => members);
    const management = createNapCatEndpointManagement({ requestApi });
    await expect(management.listGroupMembers?.({ groupId: '20001' })).resolves.toEqual(members);
    expect(requestApi).toHaveBeenCalledWith({ action: 'get_group_member_list', params: { group_id: 20001 }, signal: undefined });
  });

  it('非法 gid 抛 TypeError，不发起请求', async () => {
    const requestApi = vi.fn();
    const management = createNapCatEndpointManagement({ requestApi });
    await expect(management.listGroupMembers?.({ groupId: 'abc' })).rejects.toBeInstanceOf(TypeError);
    expect(requestApi).not.toHaveBeenCalled();
  });

  it('requestApi 错误原样透传', async () => {
    const failure = new Error('NapCat retcode=100: 未登录');
    const requestApi = vi.fn(async () => {
      throw failure;
    });
    const management = createNapCatEndpointManagement({ requestApi });
    await expect(management.listFriends?.()).rejects.toBe(failure);
    await expect(management.listGroups?.()).rejects.toBe(failure);
    await expect(management.listGroupMembers?.({ groupId: '1' })).rejects.toBe(failure);
  });

  it('非数组响应归一为空数组', async () => {
    const requestApi = vi.fn(async () => ({ unexpected: true }));
    const management = createNapCatEndpointManagement({ requestApi });
    await expect(management.listFriends?.()).resolves.toEqual([]);
    await expect(management.listGroups?.()).resolves.toEqual([]);
    await expect(management.listGroupMembers?.({ groupId: '1' })).resolves.toEqual([]);
  });

  it('能力按实现自动暴露（无 listChannels / 写操作）', () => {
    const management = createNapCatEndpointManagement({ requestApi: vi.fn() });
    expect(listEndpointManagementCapabilities({ management })).toEqual(expectedCapabilities);
  });
});

describe('napcat endpoint management wiring', () => {
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
      await createEndpointHarness(() => new NapCatWsEndpoint({ id: endpointKey, config: wsConfig, createWebSocket: createSocket }), { name: 'napcat', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
      await createEndpointHarness(() => new NapCatWssEndpoint({ id: endpointKey, http: httpStub, config: wssConfig }), { name: 'napcat', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
      await createEndpointHarness(() => new NapCatHttpEndpoint({ id: endpointKey, http: httpStub, config: httpConfig }), { name: 'napcat', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
    ];
    for (const endpoint of endpoints) {
      await endpoint.start(); endpoint.open();
      expect(listEndpointManagementCapabilities(endpoint.endpoint)).toEqual(expectedCapabilities);
      const requestApi = vi.spyOn(endpoint.endpoint, 'requestApi').mockResolvedValue([
        { user_id: 10001, nickname: 'Alice' },
      ]);
      await expect(endpoint.index.management(endpoint.canonicalId)!.listFriends?.()).resolves.toEqual([
        { user_id: 10001, nickname: 'Alice', remark: '' },
      ]);
      expect(requestApi).toHaveBeenCalledWith({ action: 'get_friend_list', signal: expect.any(AbortSignal) });
      await endpoint.stop();
    }
  });
});
