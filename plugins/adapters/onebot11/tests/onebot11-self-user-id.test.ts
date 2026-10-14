import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { getProcessPeerRegistry, retireEndpoint } from 'zhin.js/adapter';
import { OneBot11WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot11WssEndpoint } from '../src/wss-endpoint.js';
import { resolveOnebot11SelfId } from '../src/self-id.js';
import { resolveOneBot11Config, type OneBot11WsConfig } from '../src/protocol.js';
import type { OneBot11WsSocket } from '../src/ws-types.js';

const config: OneBot11WsConfig = resolveOneBot11Config({
  connection: 'ws',
  id: 'config-name-not-account',
  url: 'ws://127.0.0.1:6700',
  reconnect_interval: 50,
  heartbeat_interval: 60_000,
}) as OneBot11WsConfig;

function createMockWs() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: string[] = [];
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const ws = {
    readyState: 1,
    sent,
    send: vi.fn((data: string) => { sent.push(data); }),
    close: vi.fn(),
    ping: vi.fn(),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emitOpen: () => emit('open'),
    emitMessage: (data: string) => emit('message', data),
  };
  return ws as typeof ws & OneBot11WsSocket;
}

function createEndpoint(ws: ReturnType<typeof createMockWs>, probeLoginInfo: boolean) {
  const gateway = { receive: vi.fn(async () => undefined), send: vi.fn(async () => 'sent') };
  return bindTestEndpoint(new OneBot11WsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'onebot11'),
    config,
    probeLoginInfo,
    createWebSocket: () => {
      queueMicrotask(() => ws.emitOpen());
      return ws;
    },
  } as never), gateway, undefined);
}

const registry = getProcessPeerRegistry();

describe('resolveOnebot11SelfId', () => {
  it('accepts positive ids and rejects empty / zero / invalid values', () => {
    expect(resolveOnebot11SelfId(10001)).toBe('10001');
    expect(resolveOnebot11SelfId(' abc ')).toBe('abc');
    for (const bad of [0, -1, NaN, '', '  ', '0', undefined, null, {}]) {
      expect(resolveOnebot11SelfId(bad)).toBeUndefined();
    }
  });
});

describe('OneBot11WsEndpoint selfUserId', () => {
  it('reports self_id from inbound events and never uses config.id', async () => {
    const ws = createMockWs();
    const endpoint = createEndpoint(ws, false);
    await endpoint.start();
    expect(endpoint.selfUserId).toBeUndefined();
    expect(registry.isReady('test-endpoint')).toBe(false);
    endpoint.open();
    endpoint.client.ingest({
      post_type: 'message', message_type: 'private', message_id: 1, self_id: 20002,
      user_id: 9, raw_message: 'hi', message: [{ type: 'text', data: { text: 'hi' } }],
    });
    await vi.waitFor(() => expect(endpoint.selfUserId).toBe('20002'));
    expect(registry.selfOf('test-endpoint')).toBe('20002');
    expect(registry.lookup('test-endpoint', 'config-name-not-account')).toBeUndefined();
    retireEndpoint(endpoint);
    await endpoint.stop();
    expect(registry.isReady('test-endpoint')).toBe(false);
  });

  it('ignores events with invalid self_id', async () => {
    const ws = createMockWs();
    const endpoint = createEndpoint(ws, false);
    await endpoint.start();
    endpoint.open();
    endpoint.client.ingest({
      post_type: 'message', message_type: 'private', message_id: 1, self_id: 0,
      user_id: 9, raw_message: 'hi', message: [{ type: 'text', data: { text: 'hi' } }],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(endpoint.selfUserId).toBeUndefined();
    retireEndpoint(endpoint);
    await endpoint.stop();
  });

  it('probes get_login_info after start', async () => {
    const ws = createMockWs();
    const endpoint = createEndpoint(ws, true);
    await endpoint.start();
    await vi.waitFor(() => expect(ws.sent).toHaveLength(1));
    const request = JSON.parse(ws.sent[0]!) as { action: string; echo: string };
    expect(request.action).toBe('get_login_info');
    ws.emitMessage(JSON.stringify({
      status: 'ok', retcode: 0, data: { user_id: 30003, nickname: 'bot' }, echo: request.echo,
    }));
    await vi.waitFor(() => expect(endpoint.selfUserId).toBe('30003'));
    expect(registry.selfOf('test-endpoint')).toBe('30003');
    retireEndpoint(endpoint);
    await endpoint.stop();
  });

  it('survives a failing get_login_info without reporting', async () => {
    const ws = createMockWs();
    const endpoint = createEndpoint(ws, true);
    await expect(endpoint.start()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(ws.sent).toHaveLength(1));
    const request = JSON.parse(ws.sent[0]!) as { echo: string };
    ws.emitMessage(JSON.stringify({ status: 'failed', retcode: 1404, data: null, echo: request.echo }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(endpoint.selfUserId).toBeUndefined();
    expect(registry.isReady('test-endpoint')).toBe(false);
    retireEndpoint(endpoint);
    await endpoint.stop();
  });
  it('clears selfUserId and registry entry on stop', async () => {
    const ws = createMockWs();
    const endpoint = createEndpoint(ws, false);
    await endpoint.start();
    endpoint.open();
    endpoint.client.ingest({
      post_type: 'message', message_type: 'private', message_id: 1, self_id: 20002,
      user_id: 9, raw_message: 'hi', message: [{ type: 'text', data: { text: 'hi' } }],
    });
    await vi.waitFor(() => expect(registry.isReady('test-endpoint')).toBe(true));
    await endpoint.stop();
    expect(endpoint.selfUserId).toBeUndefined();
    expect(registry.isReady('test-endpoint')).toBe(false);
    retireEndpoint(endpoint);
  });

  it('does not write when stopped while get_login_info is in flight', async () => {
    const ws = createMockWs();
    const endpoint = createEndpoint(ws, true);
    await endpoint.start();
    await vi.waitFor(() => expect(ws.sent).toHaveLength(1));
    const request = JSON.parse(ws.sent[0]!) as { echo: string };
    endpoint.open();
    await endpoint.stop();
    ws.emitMessage(JSON.stringify({
      status: 'ok', retcode: 0, data: { user_id: 30003, nickname: 'bot' }, echo: request.echo,
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(endpoint.selfUserId).toBeUndefined();
    expect(registry.isReady('test-endpoint')).toBe(false);
    retireEndpoint(endpoint);
  });
});

describe('OneBot11WssEndpoint selfUserId', () => {
  function createWss(probeLoginInfo: boolean) {
    let accept!: (connection: unknown) => void;
    const http = { ws: () => ({ onConnection(fn: typeof accept) { accept = fn; return vi.fn(); } }) };
    const gateway = { receive: vi.fn(async () => undefined), send: vi.fn(async () => 'sent') };
    const endpoint = bindTestEndpoint(new OneBot11WssEndpoint({
      id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'onebot11'),
      http: http as never,
      config: resolveOneBot11Config({
        connection: 'wss', id: 'reverse-name-not-account', path: '/test', access_token: 'test', heartbeat_interval: 60_000,
      }) as never,
      probeLoginInfo,
    } as never), gateway, undefined);
    const connect = (ws: ReturnType<typeof createMockWs>) => accept({
      socket: ws,
      request: { headers: { authorization: 'Bearer test' }, url: '/', socket: { remoteAddress: '127.0.0.1' } },
    });
    return { endpoint, connect };
  }

  it('reports self_id from inbound events and clears on stop', async () => {
    const { endpoint, connect } = createWss(false);
    const ws = createMockWs();
    await endpoint.start();
    connect(ws);
    await vi.waitFor(() => expect(endpoint.transportState).toBe('open'));
    endpoint.open();
    expect(registry.isReady('test-endpoint')).toBe(false);
    ws.emitMessage(JSON.stringify({
      post_type: 'message', message_type: 'private', message_id: 1, self_id: 40004,
      user_id: 9, raw_message: 'hi', message: [{ type: 'text', data: { text: 'hi' } }],
    }));
    await vi.waitFor(() => expect(endpoint.selfUserId).toBe('40004'));
    expect(registry.selfOf('test-endpoint')).toBe('40004');
    expect(registry.lookup('test-endpoint', 'reverse-name-not-account')).toBeUndefined();
    await endpoint.stop();
    expect(endpoint.selfUserId).toBeUndefined();
    expect(registry.isReady('test-endpoint')).toBe(false);
    retireEndpoint(endpoint);
  });

  it('probes get_login_info after the connection when enabled', async () => {
    const { endpoint, connect } = createWss(true);
    const ws = createMockWs();
    await endpoint.start();
    connect(ws);
    await vi.waitFor(() => expect(ws.sent).toHaveLength(1));
    const request = JSON.parse(ws.sent[0]!) as { action: string; echo: string };
    expect(request.action).toBe('get_login_info');
    endpoint.open();
    ws.emitMessage(JSON.stringify({
      status: 'ok', retcode: 0, data: { user_id: 50005, nickname: 'bot' }, echo: request.echo,
    }));
    await vi.waitFor(() => expect(endpoint.selfUserId).toBe('50005'));
    expect(registry.selfOf('test-endpoint')).toBe('50005');
    await endpoint.stop();
    retireEndpoint(endpoint);
  });

  it('does not write when stopped while get_login_info is in flight', async () => {
    const { endpoint, connect } = createWss(true);
    const ws = createMockWs();
    await endpoint.start();
    connect(ws);
    await vi.waitFor(() => expect(ws.sent).toHaveLength(1));
    const request = JSON.parse(ws.sent[0]!) as { echo: string };
    endpoint.open();
    await endpoint.stop();
    ws.emitMessage(JSON.stringify({
      status: 'ok', retcode: 0, data: { user_id: 50005, nickname: 'bot' }, echo: request.echo,
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(endpoint.selfUserId).toBeUndefined();
    expect(registry.isReady('test-endpoint')).toBe(false);
    retireEndpoint(endpoint);
  });
});
