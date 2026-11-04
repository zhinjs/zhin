import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { slackFixture } from './fixture.js';
import { resolveSlackConfig } from '../src/protocol.js';
import type { SlackSocketLike } from '../src/endpoint.js';
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

it('drains an accepted Socket Mode ACK and its message through close, then rejects closed callbacks before ACK', async () => {
  const ack = gate(), receive = vi.fn(async () => undefined);
  const socket = Object.assign(new EventEmitter(), { start: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) });
  const f = await slackFixture({ id: 'slack-receipt' as never, config: resolveSlackConfig({ id: 'bot', token: 'xoxb-synthetic', appToken: 'xapp-synthetic' }),
    createSocket: () => socket as unknown as SlackSocketLike }, () => ({ auth: { test: async () => ({ user_id: 'BOT' }) } }), { receive });
  await f.start(); f.open();
  const body = { type: 'event_callback', event: { type: 'message', channel: 'C1', channel_type: 'channel', user: 'U1', ts: '1700000000.1', text: 'accepted' } };
  const acknowledge = vi.fn(() => ack.promise);
  socket.emit('slack_event', { ack: acknowledge, body });
  expect(acknowledge).toHaveBeenCalledOnce();
  let finished = false; const closing = f.close().then(() => { finished = true; });
  try {
    await new Promise(resolve => setImmediate(resolve)); expect(finished).toBe(false);
    ack.resolve(); await closing;
    expect(receive).toHaveBeenCalledOnce(); expect(receive).toHaveBeenCalledWith(expect.objectContaining({ event: body }));
    const late = vi.fn(async () => undefined);
    socket.emit('slack_event', { ack: late, body: { ...body, event: { ...body.event, ts: '1700000000.2' } } });
    await new Promise(resolve => setImmediate(resolve)); expect(late).not.toHaveBeenCalled();
  } finally { ack.resolve(); await closing; await f.stop(); }
});


it('cancels the logical ACK wait before SDK disconnect, without dispatching the cancelled message', async () => {
  const ack = gate(), receive = vi.fn(async () => undefined);
  const socket = Object.assign(new EventEmitter(), {
    start: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => { ack.resolve(); }),
  });
  const f = await slackFixture({
    id: 'slack-stop-receipt' as never,
    config: resolveSlackConfig({ id: 'bot', token: 'xoxb-synthetic', appToken: 'xapp-synthetic' }),
    createSocket: () => socket as unknown as SlackSocketLike,
  }, () => ({ auth: { test: async () => ({ user_id: 'BOT' }) } }), { receive });
  await f.start(); f.open();
  const body = { type: 'event_callback', event: { type: 'message', channel: 'C1', channel_type: 'channel', user: 'U1', ts: '1700000000.3', text: 'cancelled' } };
  const acknowledge = vi.fn(() => ack.promise);
  socket.emit('slack_event', { ack: acknowledge, body });
  expect(acknowledge).toHaveBeenCalledOnce();
  const stopping = f.stop();
  try {
    await vi.waitFor(() => expect(socket.disconnect).toHaveBeenCalledOnce());
    await stopping;
    expect(receive).not.toHaveBeenCalled();
    const late = vi.fn(async () => undefined);
    socket.emit('slack_event', { ack: late, body });
    await new Promise(resolve => setImmediate(resolve));
    expect(late).not.toHaveBeenCalled();
  } finally { ack.resolve(); await stopping; }
});
