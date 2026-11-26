import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { IpadWechatEndpoint, resolveIpadWechatConfig } from '../src/index.js';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { FakeIpadClient, fakeSdk, message } from './fake-sdk.js';

// #1250 adapter-inbound-deadlock: the SDK ACKs a delivery when its listener settles. A listener that
// settled only after the dispatch (an Agent turn waiting for the user's reply) would hold that reply's
// delivery wherever the SDK delivers in order; it settles on hand-over instead.
it('acknowledges a delivery once the Runtime accepted it, while its dispatch still runs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ipad-wechat-handoff-'));
  const client = new FakeIpadClient();
  let answered!: () => void;
  const answer = new Promise<void>(resolve => { answered = resolve; });
  const receive = vi.fn(async (payload: { content?: string }) => {
    if (payload.content === 'yes') { answered(); return; }
    await answer; // the turn waits for the user's reply
  });
  const h = await createEndpointHarness(() => new IpadWechatEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bot'),
    config: resolveIpadWechatConfig({ id: 'bot', dataDir: directory }), sdk: fakeSdk(client),
  }), { capabilities: ['inbound', 'outbound'], gateway: createTestEndpointEventGateway({ receive: async (event) => {
    if (event.name !== 'message.receive') return undefined;
    event.accepted?.(); // as the Runtime does once the message is recorded, before its dispatch
    return receive(event.payload as { content?: string });
  } }) });
  const settledWithin = (promise: Promise<unknown>) => Promise.race([promise.then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_000))]);
  try {
    await h.start(); h.open();
    expect(await settledWithin(client.deliver(message({ id: 'm1', body: 'run it' })))).toBe(true);
    expect(await settledWithin(client.deliver(message({ id: 'm2', body: 'yes' })))).toBe(true);
    await answer;
    expect(receive).toHaveBeenCalledTimes(2);
  } finally { answered(); await h.stop(); rmSync(directory, { recursive: true, force: true }); }
});
