import { afterEach, expect, it, vi } from 'vitest';
import { httpHostToken } from '@zhin.js/host-http';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createAdapterHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import definition from '../adapters/telegram/index.js';
import { TelegramAdapter } from '../src/adapter.js';
import { TelegramClient } from '../src/telegram-client.js';
import { TelegramEndpoint } from '../src/endpoint.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('runs the actual Telegram factory with its substantive API Client and preserves the original Update through Index ingress', async () => {
  const events: EndpointEvent[] = [];
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify({ ok: true,
    result: url.endsWith('/getMe') ? { id: 123, username: 'synthetic_bot' }
      : url.endsWith('/sendMessage') ? { message_id: 42 } : true }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const route = vi.fn(() => () => undefined);
  const harness = await createAdapterHarness(definition, { id: 'bot', token: '123:synthetic', polling: false,
    webhook: { domain: 'https://test.invalid', secretToken: 'synthetic-secret' } }, {
    name: 'telegram', resources: new Map([[httpHostToken.id, { route }]]),
    gateway: createTestEndpointEventGateway({ receive: async event => { events.push(event); } }),
  });
  try {
    expect(harness.adapter).toBeInstanceOf(TelegramAdapter);
    const endpoint = harness.endpoint;
    if (!(endpoint instanceof TelegramEndpoint)) throw new Error('Factory did not produce the real Endpoint');
    expect(endpoint).toBeInstanceOf(TelegramClient);
    expect(endpoint.callApi).toBe(TelegramClient.prototype.callApi);
    expect(Object.hasOwn(TelegramEndpoint.prototype, 'start')).toBe(false);
    await harness.start(); harness.open();
    const update = { update_id: 1, message: { message_id: 7, date: 1_700_000_000,
      chat: { id: 9, type: 'private' as const }, from: { id: 8, first_name: 'Alice' }, text: 'hello' } };
    await endpoint.handleUpdate(update);
    const received = events.find(event => event.name === 'message.receive');
    expect(received).toMatchObject({ client: endpoint, payload: { event: update, platformSentAt: 1_700_000_000_000, endpointId: 'bot' } });
    expect((received!.payload as { event: unknown }).event).toBe(update);
    expect(await harness.send({ conversation: { endpoint: { id: harness.canonicalId, adapter: 'telegram' }, kind: 'private', id: '9' }, payload: 'reply' })).toBe('42');
    expect(fetch.mock.calls.every(([url]) => url.startsWith('https://api.telegram.org/bot123:synthetic/'))).toBe(true);
  } finally { await harness.stop(); }
});
