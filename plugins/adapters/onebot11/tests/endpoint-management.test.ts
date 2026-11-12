import { wsConnectionFromMock } from '../../test-utils/http.js';
import { EventEmitter } from 'node:events';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { OneBotV11Client } from '@imhelper/onebot-v11';
import { describe, expect, it, vi } from 'vitest';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createOneBot11EndpointManagement } from '../src/endpoint-management.js';
import {
  resolveOneBot11Config,
  type OneBot11WsConfig,
  type OneBot11WssConfig,
} from '../src/protocol.js';
import { OneBot11WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot11WssEndpoint } from '../src/wss-endpoint.js';

const adapterFeature = featureId('zhin.adapter');
const endpointKey = capabilityId(rootPluginId(), adapterFeature, 'onebot11');
const gateway: OutboundMessageService = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
const sockets: ReturnType<typeof createSocket>[] = [];
const httpStub = {
  ws: vi.fn(() => ({ onConnection: (receive: (connection: unknown) => void) => {
    queueMicrotask(() => receive(wsConnectionFromMock({ socket: createSocket(), request: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } })));
    return () => undefined;
  } })), route: vi.fn(() => () => undefined),
} as unknown as HttpHost;
function createSocket() {
  const socket = Object.assign(new EventEmitter(), { readyState: 1, ping: vi.fn(), close: vi.fn(),
    send: vi.fn((raw: string) => {
      const request = JSON.parse(raw);
      const data = request.action === 'get_group_list' ? [{ group_id: '20001', group_name: '技术群' }] : [{ user_id: 10001, nickname: 'Alice' }];
      queueMicrotask(() => socket.emit('message', JSON.stringify({ status: 'ok', retcode: 0, echo: request.echo, data })));
    }),
  });
  sockets.push(socket); queueMicrotask(() => socket.emit('open')); return socket;
}

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
    expect(callApi).toHaveBeenCalledWith({ action: 'get_friend_list', signal: undefined });
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
    expect(callApi).toHaveBeenCalledWith({ action: 'get_group_list', signal: undefined });
  });

  it('群成员列表保持平台原生形状，gid 字符串收敛为数字', async () => {
    const members = [
      { user_id: 10001, nickname: 'Alice', role: 'owner' },
      { user_id: 10002, card: 'Bob卡' },
    ];
    const callApi = vi.fn(async () => members);
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listGroupMembers?.({ groupId: '20001' })).resolves.toEqual(members);
    expect(callApi).toHaveBeenCalledWith({ action: 'get_group_member_list', signal: undefined, params: { group_id: 20001 } });
  });

  it('非法 gid 抛 TypeError，不发起请求', async () => {
    const callApi = vi.fn();
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listGroupMembers?.({ groupId: 'abc' })).rejects.toBeInstanceOf(TypeError);
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
    await expect(management.listGroupMembers?.({ groupId: '1' })).rejects.toBe(failure);
  });

  it('非数组响应归一为空数组', async () => {
    const callApi = vi.fn(async () => ({ unexpected: true }));
    const management = createOneBot11EndpointManagement({ callApi });
    await expect(management.listFriends?.()).resolves.toEqual([]);
    await expect(management.listGroups?.()).resolves.toEqual([]);
    await expect(management.listGroupMembers?.({ groupId: '1' })).resolves.toEqual([]);
  });

  it('能力按实现自动暴露（无 listChannels / 写操作）', () => {
    const management = createOneBot11EndpointManagement({ callApi: vi.fn() });
    expect(listEndpointManagementCapabilities({ management })).toEqual(expectedCapabilities);
  });
});

describe('onebot11 endpoint management wiring', () => {
  it('ws/wss 两种传输都暴露 management 语义端口', async () => {
    const wsConfig = resolveOneBot11Config({
      connection: 'ws',
      id: 'test-ob11',
      url: 'ws://127.0.0.1:6700',
    }) as OneBot11WsConfig;
    const wssConfig = resolveOneBot11Config({
      connection: 'wss',
      id: 'test-ob11',
      path: '/onebot11',
    }) as OneBot11WssConfig;

    const endpoints = [
      await createEndpointHarness(() => new OneBot11WsEndpoint({ id: endpointKey, config: wsConfig, createWebSocket: createSocket }), { name: 'onebot11', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
      await createEndpointHarness(() => new OneBot11WssEndpoint({ id: endpointKey, http: httpStub, config: wssConfig }), { name: 'onebot11', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) }),
    ];
    for (const endpoint of endpoints) {
      await endpoint.start(); endpoint.open();
      await vi.waitFor(() => expect(endpoint.index.describe()[0]?.transportState).toBe('open'));
      expect(endpoint.endpoint).toBeInstanceOf(OneBotV11Client);
      expect(listEndpointManagementCapabilities(endpoint.endpoint)).toEqual(expectedCapabilities);
      await expect(endpoint.index.management(endpoint.canonicalId)!.listFriends?.()).resolves.toEqual([
        { user_id: 10001, nickname: 'Alice', remark: '' },
      ]);
      expect(sockets.at(-1)!.send.mock.calls.map(([raw]) => JSON.parse(raw).action)).toContain('get_friend_list');
      await endpoint.stop();
    }
  });
});

describe('onebot11 reverse WebSocket access (ADR 0054 §3)', () => {
  async function mount(accessToken?: string) {
    let accept!: (connection: unknown) => void;
    const ws = vi.fn((_path: string, _options?: unknown) => ({ onConnection: (listener: (connection: unknown) => void) => { accept = listener; return () => undefined; } }));
    const http = { ws, route: vi.fn(() => () => undefined) } as unknown as HttpHost;
    const config = resolveOneBot11Config({ connection: 'wss', id: 'acl-ob11', path: '/onebot11', ...(accessToken ? { access_token: accessToken } : {}) }) as OneBot11WssConfig;
    const endpoint = await createEndpointHarness(() => new OneBot11WssEndpoint({ id: endpointKey, http, config }), { name: 'onebot11', capabilities: ['inbound', 'outbound'], operations: ['recall'], gateway: createTestEventGateway(gateway, undefined) });
    await endpoint.start();
    const connect = (request: { authorization?: string; url?: string; ip: string }) => {
      const socket = createSocket();
      accept(wsConnectionFromMock({ socket, request: { headers: request.authorization ? { authorization: request.authorization } : {}, url: request.url ?? '/onebot11', socket: { remoteAddress: request.ip } } }));
      return socket;
    };
    return { ws, endpoint, connect };
  }
  const rejected = (socket: { close: ReturnType<typeof vi.fn> }) => socket.close.mock.calls.some(([code]) => code === 4003);

  it('mounts with protocol auth and checks its own access_token', async () => {
    const { ws, endpoint, connect } = await mount('secret');
    expect(ws).toHaveBeenCalledWith('/onebot11', { auth: 'protocol' });
    const wrong = connect({ authorization: 'Bearer console-session-token', ip: '127.0.0.1' });
    await vi.waitFor(() => expect(rejected(wrong)).toBe(true));
    const good = connect({ url: `${'/onebot11'}?access_token=secret`, ip: '203.0.113.9' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(rejected(good)).toBe(false);
    await endpoint.stop();
  });

  it('without access_token admits loopback peers only', async () => {
    const { endpoint, connect } = await mount();
    const remote = connect({ ip: '192.168.1.20' });
    await vi.waitFor(() => expect(rejected(remote)).toBe(true));
    const local = connect({ ip: '127.0.0.1' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(rejected(local)).toBe(false);
    await endpoint.stop();
  });
});

describe('inspectSelfStanding (ADR 0056 §1)', () => {
  it('re-reads the login account after it changes (reconnect / another account) and after a failure', async () => {
    vi.useFakeTimers();
    try {
      let account = 42;
      let fail = false;
      const members: unknown[] = [];
      const management = createOneBot11EndpointManagement({ callApi: async (request: { action: string; params?: { user_id?: number } }) => {
        if (request.action === 'get_login_info') return { user_id: account };
        members.push(request.params?.user_id);
        if (fail) throw new Error('offline');
        return { role: 'admin', member: { role: 'admin' } };
      } } as never);
      const signal = new AbortController().signal;
      const group = { conversation: { kind: 'group' as const, id: '20001' }, signal };
      await management.inspectSelfStanding!(group);
      account = 43;
      vi.advanceTimersByTime(6_000);
      await management.inspectSelfStanding!(group);
      fail = true;
      await expect(management.inspectSelfStanding!(group)).rejects.toThrow('offline');
      fail = false; account = 44;
      await management.inspectSelfStanding!(group);
      expect(members).toEqual([42, 43, 43, 44]);
    } finally { vi.useRealTimers(); }
  });

  it('reads the bot\'s own group role once logged in and reports nothing outside groups', async () => {
    const calls: { action: string; params?: unknown }[] = [];
    const management = createOneBot11EndpointManagement({ callApi: async (request: { action: string; params?: unknown }) => {
      calls.push({ action: request.action, params: request.params });
      return request.action === 'get_login_info' ? { user_id: 42 } : { role: 'admin' };
    } } as never);
    const signal = new AbortController().signal;
    expect(await management.inspectSelfStanding!({ conversation: { kind: 'group', id: '20001' }, signal })).toEqual({ standing: 'admin' });
    expect(await management.inspectSelfStanding!({ conversation: { kind: 'group', id: '20002' }, signal })).toEqual({ standing: 'admin' });
    expect(await management.inspectSelfStanding!({ conversation: { kind: 'private', id: '1' }, signal })).toBeUndefined();
    expect(calls.map(call => call.action)).toEqual(['get_login_info', 'get_group_member_info', 'get_group_member_info']);
    expect(calls[1]!.params).toEqual({ group_id: 20001, user_id: 42, no_cache: true });
  });
});
