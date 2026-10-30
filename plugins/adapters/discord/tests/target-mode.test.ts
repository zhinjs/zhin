import { afterEach, expect, it, vi } from 'vitest';
import { Client, Message } from 'discord.js';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import definition from '../adapters/discord/index.js';
import { DiscordAdapter } from '../src/adapter.js';
import { DiscordGatewayEndpoint } from '../src/endpoint.js';

afterEach(() => vi.restoreAllMocks());

it('runs the real Discord gateway action and retains the SDK Message object through actual Index ingress', async () => {
  vi.spyOn(Client.prototype, 'login').mockImplementation(async function () {
    Reflect.apply(this.emit, this, ['clientReady', this]); return 'synthetic-token';
  });
  const events: EndpointEvent[] = [];
  const harness = await createAdapterHarness(definition, { id: 'bot', token: 'synthetic-token' }, {
    name: 'discord', gateway: { receive: async event => { events.push(event); } },
  });
  try {
    expect(harness.adapter).toBeInstanceOf(DiscordAdapter);
    const endpoint = harness.endpoint;
    if (!(endpoint instanceof DiscordGatewayEndpoint)) throw new Error('Factory did not produce the real Endpoint');
    expect(endpoint).toBeInstanceOf(Client);
    expect(endpoint.login).toBe(Client.prototype.login);
    expect(endpoint.emit).toBe(Client.prototype.emit);
    expect(Object.hasOwn(DiscordGatewayEndpoint.prototype, 'start')).toBe(false);
    await harness.start(); harness.open();
    const native = vi.fn(); endpoint.on('messageCreate', native);
    // Installed SDK gateway action constructs the rich Message and its uncached partial DM channel.
    const actions = endpoint as unknown as { actions: { MessageCreate: { handle(data: Record<string, unknown>): unknown } } };
    actions.actions.MessageCreate.handle({ id: '100000000000000001', channel_id: '100000000000000002', channel_type: 1, type: 0,
      author: { id: '100000000000000003', username: 'Alice', discriminator: '0', bot: false },
      content: 'hello', timestamp: '2026-09-30T00:00:00Z', attachments: [], embeds: [], mentions: [], mention_roles: [], pinned: false, tts: false });
    await vi.waitFor(() => expect(events.some(event => event.name === 'message.receive')).toBe(true));
    const received = events.find(event => event.name === 'message.receive')!;
    const original = native.mock.calls[0][0];
    expect(original).toBeInstanceOf(Message);
    expect(received.client).toBe(endpoint);
    expect((received.payload as { event: unknown }).event).toBe(original);
    // discord.js derives this property from the snowflake, rather than the payload's timestamp string.
    expect(received.payload).toMatchObject({ platformSentAt: original.createdTimestamp });
  } finally { await harness.stop(); }
});
