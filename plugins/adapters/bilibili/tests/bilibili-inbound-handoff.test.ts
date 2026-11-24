import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { BilibiliEndpoint } from '../src/endpoint.js';
import { resolveBilibiliConfig, type BilibiliReply } from '../src/protocol.js';
import type { BilibiliFetch } from '../src/client.js';

const reply = (rpid: number): BilibiliReply => ({ rpid, oid: 170001, type: 1, mid: 42, root: 0, parent: 0, ctime: rpid,
  member: { mid: '42', uname: 'viewer' }, content: { message: `comment ${rpid}` } });

// #1250 adapter-inbound-deadlock: a turn started by comment 1 waits for the viewer's answer (comment 2),
// which only the next poll can fetch; pollOnce must not wait for that turn.
it('finishes a poll once its new comments were handed over, so the next poll can fetch the answer', async () => {
  const pages = [[reply(1)], [reply(1), reply(2)], [reply(1), reply(2), reply(3)]];
  let call = 0;
  const fetch: BilibiliFetch = vi.fn(async (url: string) => {
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) });
    if (url.includes('/x/web-interface/nav')) return ok({ isLogin: true, mid: 99 });
    if (url.includes('/x/web-interface/view')) return ok({ aid: 170001 });
    if (url.includes('/x/v2/reply?')) return ok({ replies: pages[Math.min(call++, pages.length - 1)], upper: { mid: 7 } });
    throw new Error(`unexpected ${url}`);
  });
  let answered!: () => void;
  const answer = new Promise<void>(resolve => { answered = resolve; });
  const receive = vi.fn(async (payload: { message?: { id?: string } }) => {
    if (payload.message?.id === '3') { answered(); return; }
    await answer; // the turn waits for the viewer's reply
  });
  const endpoint = await createEndpointHarness(() => new BilibiliEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bilibili-test'),
    autoPoll: false, fetch, config: resolveBilibiliConfig({ id: 'bili', videos: ['BV1xx411c7mD'], sessdata: 's', biliJct: 'c' }) }),
  { name: 'bilibili', capabilities: ['inbound', 'outbound'], gateway: createTestEndpointEventGateway({ receive: async (event) => {
    if (event.name !== 'message.receive') return undefined;
    event.accepted?.(); // as the Runtime does once the message is recorded, before its dispatch
    return receive(event.payload as { message?: { id?: string } });
  } }) });
  const settledWithin = (promise: Promise<unknown>) => Promise.race([promise.then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_000))]);
  try {
    await endpoint.start(); endpoint.open();
    await endpoint.endpoint.pollOnce(); // baseline
    expect(await settledWithin(endpoint.endpoint.pollOnce())).toBe(true);
    expect(await settledWithin(endpoint.endpoint.pollOnce())).toBe(true);
    await answer;
    expect(receive.mock.calls.map(([payload]) => payload.message?.id)).toEqual(['2', '3']);
  } finally { answered(); await endpoint.stop(); }
});
