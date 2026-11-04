import { afterEach, expect, it, vi } from 'vitest';
import { WebClient } from '@slack/web-api';
import { httpHostToken } from '@zhin.js/host-http';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createAdapterHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import definition from '../adapters/slack/index.js';
import { SlackAdapter } from '../src/adapter.js';
import { SlackEndpoint } from '../src/endpoint.js';

afterEach(() => vi.restoreAllMocks());

it('keeps the real Slack WebClient and exact ingress envelope without creating a Socket in HTTP mode', async () => {
  const api = vi.spyOn(WebClient.prototype, 'apiCall').mockImplementation(async method => {
    if (method === 'auth.test') return { ok: true, user_id: 'bot', team_id: 'workspace' };
    if (method === 'chat.postMessage') return { ok: true, ts: '1700000001.001' };
    throw new Error(`Unexpected fake API method ${method}`);
  });
  const events: EndpointEvent[] = [];
  const harness = await createAdapterHarness(definition, { id: 'bot', token: 'synthetic-token', socketMode: false, signingSecret: 'synthetic-signing' }, {
    name: 'slack', resources: new Map([[httpHostToken.id, { route: vi.fn(() => () => undefined) }]]),
    gateway: createTestEndpointEventGateway({ receive: async event => { events.push(event); } }),
  });
  try {
    expect(harness.adapter).toBeInstanceOf(SlackAdapter);
    const endpoint = harness.endpoint;
    if (!(endpoint instanceof SlackEndpoint)) throw new Error('Factory did not produce the real Endpoint');
    expect(endpoint).toBeInstanceOf(WebClient);
    expect(endpoint.apiCall).toBe(WebClient.prototype.apiCall);
    expect(endpoint.on).toBe(WebClient.prototype.on);
    expect(Object.hasOwn(SlackEndpoint.prototype, 'start')).toBe(false);
    await harness.start(); harness.open();
    const envelope = { type: 'event_callback', event: { type: 'message', channel: 'D1', channel_type: 'im', user: 'alice', text: 'hello', ts: '1700000000.001' } };
    endpoint.handleEnvelope(envelope);
    await vi.waitFor(() => expect(events.some(event => event.name === 'message.receive')).toBe(true));
    const received = events.find(event => event.name === 'message.receive')!;
    expect(received.client).toBe(endpoint);
    expect((received.payload as { event: unknown }).event).toBe(envelope);
    expect(await harness.send({ conversation: { endpoint: { id: harness.canonicalId, adapter: 'slack' }, kind: 'private', id: 'D1' }, payload: 'reply' })).toContain('1700000001.001');
    expect(api.mock.calls.map(([method]) => method)).toEqual(['auth.test', 'chat.postMessage']);
  } finally { await harness.stop(); }
});
