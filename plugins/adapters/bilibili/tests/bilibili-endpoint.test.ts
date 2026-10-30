import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { BilibiliEndpoint } from '../src/endpoint.js';
import {
  formatOutboundText,
  parseThreadConversationId,
  parseVideoRef,
  resolveBilibiliConfig,
  threadRootOf,
  type BilibiliReply,
} from '../src/protocol.js';
import type { BilibiliFetch } from '../src/client.js';

const endpointId = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bilibili-test');

function reply(rpid: number, extra: Partial<BilibiliReply> = {}): BilibiliReply {
  return {
    rpid, oid: 170001, type: 1, mid: 42, root: 0, parent: 0, ctime: rpid,
    member: { mid: '42', uname: 'viewer' }, content: { message: `comment ${rpid}` },
    ...extra,
  };
}

function fakeFetch(pages: BilibiliReply[][], options: { selfMid?: number; riskCode?: number } = {}) {
  let call = 0;
  const calls: string[] = [];
  const fetch: BilibiliFetch = vi.fn(async (url: string) => {
    calls.push(url);
    const ok = (data: unknown, code = 0) => ({ ok: true, status: 200, json: async () => ({ code, data }) });
    if (url.includes('/x/web-interface/nav')) return ok({ isLogin: true, mid: options.selfMid });
    if (url.includes('/x/web-interface/view')) return ok({ aid: 170001 });
    if (url.includes('/x/v2/reply?')) {
      if (options.riskCode !== undefined && call > 0) return ok(null, options.riskCode);
      const page = pages[Math.min(call, pages.length - 1)] ?? [];
      call += 1;
      return ok({ replies: page, upper: { mid: 7 } });
    }
    throw new Error(`unexpected ${url}`);
  });
  return { fetch, calls };
}

async function makeEndpoint(fetch: BilibiliFetch, config: Record<string, unknown> = {}) {
  const receive = vi.fn(async () => undefined);
  const endpoint = await createEndpointHarness(() => new BilibiliEndpoint({
    id: endpointId,
    autoPoll: false,
    fetch,
    config: resolveBilibiliConfig({ id: 'bili', videos: ['BV1xx411c7mD'], sessdata: 's', biliJct: 'c', ...config }),
  }), { name: 'bilibili', capabilities: ['inbound', 'outbound'], gateway: createTestEventGateway({ receive }) });
  return { endpoint, receive };
}

describe('bilibili protocol', () => {
  it('parses video refs and thread ids', () => {
    expect(parseVideoRef('BV1xx411c7mD')).toEqual({ kind: 'bvid', bvid: 'BV1xx411c7mD' });
    expect(parseVideoRef('av170001')).toEqual({ kind: 'aid', aid: '170001' });
    expect(parseVideoRef(170001)).toEqual({ kind: 'aid', aid: '170001' });
    expect(() => parseVideoRef('https://evil')).toThrow();
    expect(parseThreadConversationId('video:170001:99')).toEqual({ type: 'video', oid: '170001', root: '99' });
    expect(parseThreadConversationId('video:abc')).toBeUndefined();
    expect(threadRootOf({ rpid: 5, root: 0 })).toBe('5');
    expect(threadRootOf({ rpid: 6, root: 5 })).toBe('5');
  });

  it('defaults to review mode and rejects auto', () => {
    expect(resolveBilibiliConfig({ id: 'x' }).sendMode).toBe('review');
    expect(resolveBilibiliConfig({ id: 'x', pollIntervalSec: 5 }).pollIntervalMs).toBe(60_000);
    expect(() => resolveBilibiliConfig({ id: 'x', sendMode: 'auto' as never })).toThrow(/review/);
  });

  it('formats outbound as plain text', () => {
    expect(formatOutboundText([{ type: 'text', data: { text: '谢谢' } }, { type: 'image', data: {} }])).toBe('谢谢');
  });
});

describe('BilibiliEndpoint', () => {
  it('does not advance native comment dedupe while closed and admits the same reply after reopen', async () => {
    const { fetch } = fakeFetch([[reply(1)], [reply(1), reply(2)]], { selfMid: 99 });
    const { endpoint, receive } = await makeEndpoint(fetch);
    try {
      await endpoint.start(); endpoint.open();
      await endpoint.endpoint.pollOnce();
      await endpoint.close();
      await endpoint.endpoint.pollOnce();
      expect(receive).not.toHaveBeenCalled();
      endpoint.open();
      await endpoint.endpoint.pollOnce();
      expect(receive).toHaveBeenCalledTimes(1);
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ id: '2' }) }));
    } finally { await endpoint.stop(); }
  });

  it('baselines first poll, then admits only new comments per thread, skipping self', async () => {
    const { fetch } = fakeFetch([
      [reply(1)],
      [reply(1), reply(2, { root: 1, parent: 1 }), reply(3, { mid: 99 }), reply(4)],
    ], { selfMid: 99 });
    const { endpoint, receive } = await makeEndpoint(fetch);
    await endpoint.start();
    endpoint.open();
    expect(endpoint.index.connection('bilibili', endpoint.canonicalId)?.selfUserId).toBe('99');
    expect(endpoint.endpoint.videoAids).toEqual(['170001']);

    await endpoint.endpoint.pollOnce();
    expect(receive).not.toHaveBeenCalled();

    await endpoint.endpoint.pollOnce();
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenNthCalledWith(1, expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'channel', id: 'video:170001:1', parent: { kind: 'channel', id: 'video:170001' } }),
      message: expect.objectContaining({ id: '2' }),
      content: 'comment 2',
      sender: { id: '42', name: 'viewer' },
    }));
    expect(receive).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversation: expect.objectContaining({ id: 'video:170001:4' }),
    }));

    await endpoint.endpoint.pollOnce();
    expect(receive).toHaveBeenCalledTimes(2);
    await endpoint.stop();
  });

  it('opens circuit breaker on risk codes and stops polling', async () => {
    const { fetch, calls } = fakeFetch([[reply(1)]], { riskCode: -412 });
    const { endpoint } = await makeEndpoint(fetch);
    await endpoint.start();
    endpoint.open();
    await endpoint.endpoint.pollOnce();
    await endpoint.endpoint.pollOnce();
    expect(endpoint.endpoint.circuitBreaker?.code).toBe(-412);
    expect(endpoint.index.describe()[0]?.transportState).toBe('closed');
    const before = calls.length;
    await endpoint.endpoint.pollOnce();
    expect(calls.length).toBe(before);
  });

  it('queues drafts in review mode and never calls the write API', async () => {
    const { fetch, calls } = fakeFetch([[]]);
    const { endpoint } = await makeEndpoint(fetch);
    await endpoint.start(); endpoint.open();
    const conversation = { endpoint: { id: 'e', adapter: 'bilibili' }, kind: 'channel' as const, id: 'video:170001:1' };
    const error = await endpoint.send({ conversation, payload: '感谢支持' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EndpointDeliveryError);
    expect((error as EndpointDeliveryError).code).toBe('approval_pending');
    expect((error as EndpointDeliveryError).disposition).toBe('not_sent');
    expect(endpoint.endpoint.drafts.list()).toEqual([expect.objectContaining({ oid: '170001', root: '1', message: '感谢支持' })]);
    expect(calls.some((url) => url.includes('/x/v2/reply/add'))).toBe(false);
  });

  it('refuses outbound when sendMode is off or target is not a thread', async () => {
    const { fetch } = fakeFetch([[]]);
    const { endpoint } = await makeEndpoint(fetch, { sendMode: 'off' });
    await endpoint.start(); endpoint.open();
    const thread = { endpoint: { id: 'e', adapter: 'bilibili' }, kind: 'channel' as const, id: 'video:170001:1' };
    await expect(endpoint.send({ conversation: thread, payload: 'hi' })).rejects.toMatchObject({ code: 'send_disabled' });
    await expect(endpoint.send({ conversation: { ...thread, id: 'video:170001' }, payload: 'hi' }))
      .rejects.toMatchObject({ code: 'invalid_recipient' });
    expect(endpoint.endpoint.drafts.list()).toHaveLength(0);
  });
});
