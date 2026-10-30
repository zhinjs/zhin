import { afterEach, expect, it, vi } from 'vitest';
import { Client } from 'kook-client';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import definition from '../adapters/kook/index.js';
import { KookAdapter } from '../src/adapter.js';
import { KookWebsocketEndpoint } from '../src/endpoint.js';
import { RuntimeKookClient } from '../src/ws.js';

afterEach(() => vi.restoreAllMocks());

it('retains the actual KOOK Client and native event methods through the real Adapter definition', async () => {
  vi.spyOn(RuntimeKookClient.prototype, 'connect').mockResolvedValue();
  vi.spyOn(RuntimeKookClient.prototype, 'disconnect').mockResolvedValue();
  const events: EndpointEvent[] = [], listeners = process.listenerCount('uncaughtException');
  const harness = await createAdapterHarness(definition, { id: 'bot', token: 'synthetic-token' }, {
    name: 'kook', gateway: { receive: async event => { events.push(event); } },
  });
  try {
    expect(harness.adapter).toBeInstanceOf(KookAdapter);
    const endpoint = harness.endpoint;
    if (!(endpoint instanceof KookWebsocketEndpoint)) throw new Error('Factory did not produce the real Endpoint');
    expect(endpoint).toBeInstanceOf(Client);
    expect(endpoint).toBeInstanceOf(RuntimeKookClient);
    expect(endpoint.on).toBe(Client.prototype.on);
    expect(process.listenerCount('uncaughtException')).toBe(listeners);
    await harness.start(); harness.open();
    const raw = { message_id: 'native-message', message_type: 'private', author_id: 'alice', timestamp: 1_700_000_000_000,
      raw_message: 'hello', author: { info: { nickname: 'Alice' } } };
    Reflect.apply(endpoint.emit, endpoint, ['message', raw]);
    await vi.waitFor(() => expect(events.some(event => event.name === 'message.receive')).toBe(true));
    const received = events.find(event => event.name === 'message.receive')!;
    expect(received.client).toBe(endpoint);
    expect((received.payload as { event: unknown }).event).toBe(raw);
    expect(received.payload).toMatchObject({ platformSentAt: 1_700_000_000_000 });
  } finally { await harness.stop(); }
});
