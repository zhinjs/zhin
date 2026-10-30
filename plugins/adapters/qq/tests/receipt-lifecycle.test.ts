import { expect, it, vi } from 'vitest';
import { qqFixture } from './fixture.js';
import { QqWebsocketEndpoint } from '../src/endpoint.js';
import { resolveQqConfig } from '../src/protocol.js';
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

it.each(['close', 'stop'] as const)('owns a parallel native QQ ACK across %s without delaying business dispatch', async action => {
  const ack = gate(), receive = vi.fn(async () => undefined), disconnected = vi.fn(async () => { ack.resolve(); });
  const config = resolveQqConfig({ id: 'bot', appid: 'synthetic-app', secret: 'synthetic', mode: 'websocket' });
  if (config.mode !== 'websocket') throw new Error('Expected the explicitly configured native websocket Endpoint');
  const f = await qqFixture(() => new QqWebsocketEndpoint({ id: 'qq-ack' as never, config }),
  () => ({ start: async () => undefined, stop: disconnected }), { receive });
  await f.start(); f.open();
  const reply = vi.fn(() => ack.promise.then(() => true));
  const raw = { post_type: 'notice', sub_type: 'action', notice_type: 'group', notice_id: 'click', group_id: 'group',
    operator_id: 'user', data: { resolved: { button_data: 'confirm' } }, reply };
  Reflect.apply(f.endpoint.emit, f.endpoint, ['notice', raw]);
  await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce()); expect(reply).toHaveBeenCalledOnce();
  let complete = false;
  const closing = (action === 'close' ? f.close() : f.stop()).then(() => { complete = true; });
  try {
    if (action === 'close') {
      await new Promise(resolve => setImmediate(resolve)); expect(complete).toBe(false);
      expect(disconnected).not.toHaveBeenCalled(); ack.resolve(); await closing;
    } else { await closing; expect(disconnected).toHaveBeenCalledOnce(); }
    const late = vi.fn(async () => true);
    Reflect.apply(f.endpoint.emit, f.endpoint, ['notice', { ...raw, notice_id: 'late', reply: late }]);
    await new Promise(resolve => setImmediate(resolve)); expect(late).not.toHaveBeenCalled();
    expect(receive).toHaveBeenCalledOnce();
  } finally { ack.resolve(); await closing; await f.stop(); }
});
