import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http';
import { NapCatWsEndpoint } from '../src/ws-endpoint.js';
import { NapCatHttpEndpoint } from '../src/http-endpoint.js';
import { resolveNapCatConfig } from '../src/protocol.js';
import { createEndpointHarness } from '../../test-utils/endpoint.js';

const id = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'napcat');
const incoming = {
  post_type: 'message', message_type: 'group', self_id: 1, group_id: 100, user_id: 42, message_id: 7,
  raw_message: 'native input', message: [{ type: 'text', data: { text: 'native input' } }],
};

it('does not consume a native message ID while closed before the same Client is reopened', async () => {
  class Socket extends EventEmitter {
    readyState = 1;
    send(): void {}
    ping(): void {}
    close(): void {}
  }
  const socket = new Socket();
  const config = resolveNapCatConfig({ id: 'fixture', connection: 'ws', url: 'ws://fixture.invalid' });
  if (config.connection !== 'ws') throw new Error('Expected a forward WebSocket fixture');
  const receive = vi.fn();
  const harness = await createEndpointHarness(() => new NapCatWsEndpoint({ id, config,
    createWebSocket: () => { queueMicrotask(() => socket.emit('open')); return socket; },
  }), { name: 'napcat', capabilities: ['inbound', 'outbound'], operations: ['recall'],
    gateway: { async receive(event) { if (event.name === 'message.receive') receive(event.payload); } } });
  try {
    await harness.start(); harness.open(); await harness.close();
    socket.emit('message', JSON.stringify(incoming));
    await new Promise(resolve => setImmediate(resolve));
    expect(receive).not.toHaveBeenCalled();
    harness.open(); socket.emit('message', JSON.stringify(incoming));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
    await harness.stop(); socket.emit('message', JSON.stringify({ ...incoming, message_id: 8 }));
    await new Promise(resolve => setImmediate(resolve));
    expect(receive).toHaveBeenCalledOnce();
  } finally { await harness.stop(); }
});

it('does not hold close for an incomplete Host HTTP body and rejects its parsed receipt until reopened', async () => {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  let markEntered!: () => void;
  const entered = new Promise<void>(resolve => { markEntered = resolve; });
  const register = http.route.bind(http);
  vi.spyOn(http, 'route').mockImplementation((method, path, handler, meta) => register(method, path, (...args) => {
    const result = handler(...args); markEntered(); return result;
  }, meta));
  const config = resolveNapCatConfig({ id: 'http-fixture', connection: 'http', http_url: 'http://fixture.invalid', post_path: '/native' });
  if (config.connection !== 'http') throw new Error('Expected an HTTP fixture');
  const receive = vi.fn();
  const harness = await createEndpointHarness(() => new NapCatHttpEndpoint({ id, config, http }), {
    name: 'napcat', capabilities: ['inbound', 'outbound'], operations: ['recall'],
    gateway: { async receive(event) { if (event.name === 'message.receive') receive(event.payload); } },
  });
  let pending: ReturnType<typeof request> | undefined;
  try {
    await harness.start(); harness.open(); const { port } = await http.listen();
    const response = new Promise<number | undefined>((resolve, reject) => {
      pending = request({ hostname: '127.0.0.1', port, path: '/native', method: 'POST', headers: { 'Content-Type': 'application/json' } }, result => {
        result.resume(); result.once('end', () => resolve(result.statusCode));
      });
      pending.on('error', reject); pending.write('{');
    });
    await entered;
    // The raw stream is Host-owned; no platform receipt exists until parsing completes.
    await harness.close();
    pending!.end(JSON.stringify(incoming).slice(1));
    expect(await response).toBe(200);
    expect(receive).not.toHaveBeenCalled();
    const closed = await fetch(`http://127.0.0.1:${port}/native`, { method: 'POST', body: JSON.stringify({ ...incoming, message_id: 8 }) });
    expect(closed.status).toBe(200); expect(receive).not.toHaveBeenCalled();
    const invalid = await fetch(`http://127.0.0.1:${port}/native`, { method: 'POST', body: '{invalid' });
    expect(invalid.status).toBe(400);
    harness.open();
    const reopened = await fetch(`http://127.0.0.1:${port}/native`, { method: 'POST', body: JSON.stringify(incoming) });
    expect(reopened.status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
  } finally { pending?.destroy(); await harness.stop(); await http.close(); }
});
