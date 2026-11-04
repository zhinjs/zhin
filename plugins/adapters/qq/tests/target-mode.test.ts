import { afterEach, expect, it, vi } from 'vitest';
import { Bot } from 'qq-official-bot';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createAdapterHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import definition from '../adapters/qq/index.js';
import { QqAdapter } from '../src/adapter.js';
import { QqWebsocketEndpoint } from '../src/endpoint.js';

afterEach(() => vi.restoreAllMocks());

it('creates an actual QQ Bot subclass and routes the identical native event through the owning Adapter', async () => {
  const start = vi.spyOn(Bot.prototype, 'start').mockImplementation(async function () { return this; });
  const stop = vi.spyOn(Bot.prototype, 'stop').mockResolvedValue();
  const events: EndpointEvent[] = [];
  const harness = await createAdapterHarness(definition, { id: 'bot', appid: 'synthetic-app', secret: 'synthetic-secret' }, {
    name: 'qq', gateway: createTestEndpointEventGateway({ receive: async event => { events.push(event); } }),
  });
  try {
    expect(harness.adapter).toBeInstanceOf(QqAdapter);
    const endpoint = harness.endpoint;
    if (!(endpoint instanceof QqWebsocketEndpoint)) throw new Error('Factory did not produce the real Endpoint');
    expect(endpoint).toBeInstanceOf(Bot);
    expect(endpoint.start).toBe(Bot.prototype.start);
    expect(endpoint.on).toBe(Bot.prototype.on);
    expect(Object.hasOwn(QqWebsocketEndpoint.prototype, 'start')).toBe(false);
    await harness.start(); harness.open();
    const raw = { message_id: 'native-message', message_type: 'private', user_id: 'alice',
      message: [{ type: 'text', data: { text: 'hello' } }], sender: { user_id: 'alice', user_name: 'Alice' }, timestamp: 1_700_000_000 };
    Reflect.apply(endpoint.emit, endpoint, ['message.private', raw]);
    await vi.waitFor(() => expect(events.some(event => event.name === 'message.receive')).toBe(true));
    const received = events.find(event => event.name === 'message.receive')!;
    expect(received.client).toBe(endpoint);
    expect((received.payload as { event: unknown }).event).toBe(raw);
    expect(received.payload).toMatchObject({ platformSentAt: 1_700_000_000_000 });
    expect(start).toHaveBeenCalledOnce();
  } finally { await harness.stop(); }
  expect(stop).toHaveBeenCalledOnce();
});
