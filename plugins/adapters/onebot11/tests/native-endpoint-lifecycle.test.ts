import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { Onebot11Client } from '../src/client.js';
import { OneBot11WsEndpoint } from '../src/ws-endpoint.js';
import type { OneBot11WsConfig } from '../src/protocol.js';
import type { OneBot11WsSocket } from '../src/ws-types.js';

class Socket extends EventEmitter implements OneBot11WsSocket {
  readyState = 1;
  readonly send = vi.fn<(data: string) => void>();
  close(): void { this.readyState = 3; this.emit('close', 1000, 'closed'); }
  ping(): void {}
}
const config: OneBot11WsConfig = {
  context: 'onebot11', connection: 'ws', id: 'configured-alias', url: 'ws://fixture.invalid',
  reconnect_interval: 5000, heartbeat_interval: 30_000,
};
const incoming = {
  post_type: 'message', message_type: 'group', message_id: 7, group_id: 42, user_id: 101,
  self_id: 303, sender: { nickname: 'member' }, message: [{ type: 'text', data: { text: 'first' } }], time: 1000,
};

async function fixture() {
  const socket = new Socket(), received: EndpointEvent[] = [];
  const harness = await createEndpointHarness(() => new OneBot11WsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'onebot11'), config,
    createWebSocket: () => {
      queueMicrotask(() => { socket.emit('open'); socket.emit('message', JSON.stringify(incoming)); });
      return socket;
    },
  }), { name: 'onebot11', id: config.id, capabilities: ['inbound', 'outbound'], operations: ['recall'],
    gateway: createTestEndpointEventGateway({ async receive(event) { received.push(event); } }) });
  return { ...harness, socket, received };
}

describe('OneBot11 native Endpoint lifecycle through the real Index', () => {
  it('keeps closed native frames from changing the shared self identity and accepts the same frame after reopen', async () => {
    const f = await fixture();
    const frame = { ...incoming, message_id: 10, self_id: 404 };
    try {
      await f.start(); f.open();
      await vi.waitFor(() => expect(f.received.filter(event => event.name === 'message.receive')).toHaveLength(1));
      expect(f.index.connection('onebot11', f.canonicalId)?.selfUserId).toBe('303');
      await f.close(); f.socket.emit('message', JSON.stringify(frame));
      await new Promise(resolve => setImmediate(resolve));
      expect(f.index.connection('onebot11', f.canonicalId)?.selfUserId).toBe('303');
      expect(f.received.filter(event => event.name === 'message.receive')).toHaveLength(1);
      f.open(); f.socket.emit('message', JSON.stringify(frame));
      await vi.waitFor(() => expect(f.received.filter(event => event.name === 'message.receive')).toHaveLength(2));
      expect(f.index.connection('onebot11', f.canonicalId)?.selfUserId).toBe('404');
    } finally { await f.stop(); }
  });

  it('keeps the first SDK frame during candidate start and publishes the exact native object once', async () => {
    const f = await fixture();
    const native = vi.fn(); f.endpoint.on('event', native);
    try {
      expect(f.endpoint).toBeInstanceOf(Onebot11Client);
      expect(f.endpoint.start).toBe(Onebot11Client.prototype.start);
      expect(f.endpoint.stop).toBe(Onebot11Client.prototype.stop);
      await f.start();
      expect(f.received).toHaveLength(0);
      f.open();
      await vi.waitFor(() => expect(f.received.filter(event => event.name === 'message.receive')).toHaveLength(1));
      const message = f.received.find(event => event.name === 'message.receive');
      expect(message?.client).toBe(f.endpoint);
      expect(message?.payload).toMatchObject({ content: 'first', sender: { id: '101' },
        conversation: { endpoint: { id: f.canonicalId }, kind: 'group', id: '42' }, platformSentAt: 1_000_000 });
      expect(message?.payload).toBeDefined();
      if (!message || !message.payload || typeof message.payload !== 'object' || !('event' in message.payload)) throw new Error('Missing canonical message payload');
      expect(message.payload.event).toBe(native.mock.calls[0]?.[0]);
      await f.stop();
      f.endpoint.ingest({ ...incoming, message_id: 8 });
      await Promise.resolve();
      expect(f.received.filter(event => event.name === 'message.receive')).toHaveLength(1);
      expect(f.socket.send).not.toHaveBeenCalled();
    } finally { await f.stop(); }
  });

  it('discards a candidate frame on rollback and performs no protocol action', async () => {
    const f = await fixture();
    await f.start();
    await f.stop();
    f.endpoint.ingest({ ...incoming, message_id: 9 });
    await Promise.resolve();
    expect(f.received).toHaveLength(0);
    expect(f.socket.send).not.toHaveBeenCalled();
  });
});
