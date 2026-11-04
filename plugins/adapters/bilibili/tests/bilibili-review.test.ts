import { createTestEventGateway } from '../../test-utils/endpoint.js';
import { createBilibiliHarness } from './bilibili-harness.js';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { BilibiliEndpoint, BilibiliReviewError } from '../src/endpoint.js';
import {
  notificationToReply,
  outboundReplyTarget,
  resolveBilibiliConfig,
  type BilibiliNotificationItem,
  type BilibiliReply,
} from '../src/protocol.js';
import type { BilibiliFetch } from '../src/client.js';
import { approveDraftText, discardDraftText, editDraftText, listDraftsText } from '../src/review.js';

const endpointId = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bilibili-review');
const AID = 170001;
const thread = { endpoint: { id: 'e', adapter: 'bilibili' }, kind: 'channel' as const, id: `video:${AID}:1` };

function reply(rpid: number, extra: Partial<BilibiliReply> = {}): BilibiliReply {
  return {
    rpid, oid: AID, type: 1, mid: 42, root: 0, parent: 0, ctime: rpid,
    member: { mid: '42', uname: 'viewer' }, content: { message: `comment ${rpid}` },
    ...extra,
  };
}

function notification(id: number, item: BilibiliNotificationItem['item'], mid = 55): BilibiliNotificationItem {
  return { id, user: { mid, nickname: `u${mid}` }, item: { type: 'reply', business_id: 1, ...item }, reply_time: id };
}

interface FakeOptions {
  readonly pages?: BilibiliReply[][];
  readonly feeds?: Partial<Record<'reply' | 'at', BilibiliNotificationItem[][]>>;
  readonly addCode?: number;
}

function fakeFetch(options: FakeOptions = {}) {
  let pageCall = 0;
  const feedCalls: Record<string, number> = { reply: 0, at: 0 };
  const posts: Array<Record<string, string>> = [];
  const calls: string[] = [];
  let nextRpid = 9000;
  const fetch: BilibiliFetch = vi.fn(async (url: string, init) => {
    calls.push(url);
    const ok = (data: unknown, code = 0) => ({ ok: true, status: 200, json: async () => ({ code, data }) });
    if (url.includes('/x/web-interface/nav')) return ok({ isLogin: true, mid: 99 });
    if (url.includes('/x/web-interface/view')) return ok({ aid: AID });
    if (url.includes('/x/v2/reply/add')) {
      posts.push(Object.fromEntries(new URLSearchParams(init?.body ?? '')));
      if (options.addCode) return ok(null, options.addCode);
      nextRpid += 1;
      return ok({ rpid: nextRpid, rpid_str: String(nextRpid) });
    }
    if (url.includes('/x/v2/reply?')) {
      const pages = options.pages ?? [[]];
      const page = pages[Math.min(pageCall, pages.length - 1)] ?? [];
      pageCall += 1;
      return ok({ replies: page, upper: { mid: 99 } });
    }
    const feed = /\/x\/msgfeed\/(reply|at)\?/.exec(url)?.[1] as 'reply' | 'at' | undefined;
    if (feed) {
      const pages = options.feeds?.[feed] ?? [[]];
      const items = pages[Math.min(feedCalls[feed]!, pages.length - 1)] ?? [];
      feedCalls[feed]! += 1;
      return ok({ items, cursor: { is_end: true } });
    }
    throw new Error(`unexpected ${url}`);
  });
  return { fetch, calls, posts };
}

async function makeEndpoint(fetch: BilibiliFetch, config: Record<string, unknown> = {}, clock = { now: 1_000_000 }) {
  const receive = vi.fn(async () => undefined);
  const registry = new Map<string, BilibiliEndpoint>();
  const endpoint = await createBilibiliHarness({ id: 'bili', videos: [String(AID)], sessdata: 's', biliJct: 'csrf-token', ...config },
    { fetch, now: () => clock.now }, createTestEventGateway({ receive }));
  registry.set('bili', endpoint.endpoint);
  return { endpoint, receive, registry, clock };
}

async function queueDraft(endpoint: Awaited<ReturnType<typeof createBilibiliHarness>>, payload: unknown = '感谢支持'): Promise<string> {
  await endpoint.send({ conversation: thread, payload }).catch(() => undefined);
  const drafts = endpoint.endpoint.drafts.list();
  return drafts[drafts.length - 1]!.id;
}

describe('bilibili protocol (notifications / reply target)', () => {
  it('maps video comment notifications and ignores other businesses', () => {
    expect(notificationToReply(notification(1, { subject_id: AID, root_id: 10, source_id: 11, target_id: 10, source_content: 'hi' })))
      .toMatchObject({ rpid: 11, oid: AID, root: 10, parent: 10, mid: 55, content: { message: 'hi' } });
    expect(notificationToReply(notification(2, { subject_id: AID, root_id: 0, source_id: 12, target_id: 0 })))
      .toMatchObject({ rpid: 12, root: 0, parent: 0 });
    expect(notificationToReply(notification(3, { business_id: 17, subject_id: 5, source_id: 6 }))).toBeUndefined();
    expect(notificationToReply(notification(4, { subject_id: AID, source_id: 0 }))).toBeUndefined();
  });

  it('reads reply targets only from numeric reply segments', () => {
    expect(outboundReplyTarget([{ type: 'reply', data: { id: '123' } }, { type: 'text', data: { text: 'x' } }])).toBe('123');
    expect(outboundReplyTarget([{ type: 'reply', data: { id: 'abc' } }])).toBeUndefined();
    expect(outboundReplyTarget('plain')).toBeUndefined();
  });

  it('validates notification and send-interval config', () => {
    const config = resolveBilibiliConfig({ id: 'x' });
    expect(config.notifications).toEqual([]);
    expect(config.notificationScope).toBe('whitelist');
    expect(config.minSendIntervalMs).toBe(30_000);
    expect(resolveBilibiliConfig({ id: 'x', minSendIntervalSec: 1 }).minSendIntervalMs).toBe(10_000);
    expect(() => resolveBilibiliConfig({ id: 'x', notifications: ['dm' as never] })).toThrow(/notifications/);
    expect(() => resolveBilibiliConfig({ id: 'x', notificationScope: 'everything' as never })).toThrow(/notificationScope/);
  });
});

describe('BilibiliEndpoint review-then-send', () => {
  it('send() never posts; approveDraft() posts once with csrf and dequeues', async () => {
    const { fetch, calls, posts } = fakeFetch();
    const { endpoint } = await makeEndpoint(fetch);
    const id = await queueDraft(endpoint);
    expect(calls.some((url) => url.includes('/x/v2/reply/add'))).toBe(false);

    const sent = await endpoint.endpoint.approveDraft(id);
    expect(sent.rpid).toBe('9001');
    expect(posts).toEqual([{ type: '1', oid: String(AID), root: '1', parent: '1', message: '感谢支持', csrf: 'csrf-token' }]);
    expect(endpoint.endpoint.drafts.list()).toHaveLength(0);
    await expect(endpoint.endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('uses the reply segment as parent and keeps the quoted comment for review', async () => {
    const { fetch, posts } = fakeFetch({ pages: [[reply(1)], [reply(1), reply(5, { root: 1, parent: 1, content: { message: '求更新' } })]] });
    const { endpoint } = await makeEndpoint(fetch);
    await endpoint.start();
    endpoint.open();
    await endpoint.endpoint.pollOnce();
    await endpoint.endpoint.pollOnce();
    const id = await queueDraft(endpoint, [{ type: 'reply', data: { id: '5' } }, { type: 'text', data: { text: '在做了' } }]);
    expect(endpoint.endpoint.drafts.get(id)).toMatchObject({ parent: '5', root: '1', context: { author: 'viewer', text: '求更新' } });
    await endpoint.endpoint.approveDraft(id);
    expect(posts[0]).toMatchObject({ root: '1', parent: '5', message: '在做了' });
    await endpoint.stop();
  });

  it('enforces the minimum send interval without queueing', async () => {
    const { fetch, posts } = fakeFetch();
    const { endpoint, clock } = await makeEndpoint(fetch, { minSendIntervalSec: 30 });
    const first = await queueDraft(endpoint, 'a');
    const second = await queueDraft(endpoint, 'b');
    await endpoint.endpoint.approveDraft(first);
    clock.now += 5_000;
    const error = await endpoint.endpoint.approveDraft(second).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BilibiliReviewError);
    expect(error).toMatchObject({ code: 'rate_limited', retryAfterMs: 25_000 });
    expect(endpoint.endpoint.drafts.get(second)?.status).toBe('pending');
    clock.now += 25_000;
    await endpoint.endpoint.approveDraft(second);
    expect(posts).toHaveLength(2);
  });

  it('trips the circuit breaker on risk codes and keeps the draft', async () => {
    const { fetch, posts } = fakeFetch({ addCode: 12015 });
    const { endpoint } = await makeEndpoint(fetch);
    const id = await queueDraft(endpoint);
    await expect(endpoint.endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'circuit_open' });
    expect(endpoint.endpoint.circuitBreaker?.code).toBe(12015);
    expect(endpoint.endpoint.drafts.get(id)?.status).toBe('pending');
    await expect(endpoint.endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'circuit_open' });
    expect(posts).toHaveLength(1);
  });

  it('keeps the draft on ordinary platform errors', async () => {
    const { fetch } = fakeFetch({ addCode: 12002 });
    const { endpoint } = await makeEndpoint(fetch);
    const id = await queueDraft(endpoint);
    await expect(endpoint.endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'platform_error' });
    expect(endpoint.endpoint.circuitBreaker).toBeUndefined();
    expect(endpoint.endpoint.drafts.get(id)?.status).toBe('pending');
  });

  it('refuses to post without SESSDATA + bili_jct', async () => {
    const { fetch, posts } = fakeFetch();
    const { endpoint } = await makeEndpoint(fetch, { biliJct: '' });
    const id = await queueDraft(endpoint);
    await expect(endpoint.endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'no_cookie' });
    expect(posts).toHaveLength(0);
  });

  it('edits and discards drafts before sending', async () => {
    const { fetch, posts } = fakeFetch();
    const { endpoint } = await makeEndpoint(fetch);
    const id = await queueDraft(endpoint, 'old');
    expect(endpoint.endpoint.editDraft(id, '  new text ').message).toBe('new text');
    expect(() => endpoint.endpoint.editDraft(id, '')).toThrow(BilibiliReviewError);
    expect(() => endpoint.endpoint.editDraft(id, 'x'.repeat(1001))).toThrow(/1000/);
    await endpoint.endpoint.approveDraft(id);
    expect(posts[0]?.message).toBe('new text');
    const other = await queueDraft(endpoint, 'drop me');
    expect(endpoint.endpoint.discardDraft(other)).toBe(true);
    expect(endpoint.endpoint.discardDraft(other)).toBe(false);
  });

  it('removes the stopped account from its owner Adapter directory', async () => {
    const { fetch } = fakeFetch();
    const { endpoint, registry } = await makeEndpoint(fetch);
    await endpoint.stop();
    expect(endpoint.directory().size).toBe(0);
  });
});

describe('bili-draft review texts', () => {
  it('localizes English limits and risk stops while keeping drafts and avoiding automatic retries', async () => {
    const normal = fakeFetch();
    const { endpoint, registry, clock } = await makeEndpoint(normal.fetch);
    const first = await queueDraft(endpoint, '第一条原文');
    const second = await queueDraft(endpoint, '第二条原文');
    expect(await approveDraftText(registry, first, { locale: 'en' })).toContain('Posted to Bilibili');
    expect(await approveDraftText(registry, second, { locale: 'en' })).toContain('30 seconds');
    expect(normal.posts).toHaveLength(1);
    expect(endpoint.endpoint.drafts.get(second)?.message).toBe('第二条原文');
    expect(editDraftText(registry, second, 'x'.repeat(1001), { locale: 'en' })).toContain('at most 1000 characters');
    expect(endpoint.endpoint.drafts.get(second)?.message).toBe('第二条原文');
    clock.now += 30_000;
    await approveDraftText(registry, second, { locale: 'en' });
    expect(normal.posts).toHaveLength(2);

    const risk = fakeFetch({ addCode: -412 });
    const stopped = await makeEndpoint(risk.fetch);
    const id = await queueDraft(stopped.endpoint, '风险时保留的原文');
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await approveDraftText(stopped.registry, id, { locale: 'en' })).toContain('risk controls stopped');
    }
    expect(risk.posts).toHaveLength(1);
    expect(stopped.endpoint.endpoint.drafts.get(id)?.message).toBe('风险时保留的原文');
    await endpoint.stop();
    await stopped.endpoint.stop();
  });

  it('lists, edits, sends and drops drafts across endpoints', async () => {
    const { fetch, posts } = fakeFetch();
    const { endpoint, registry } = await makeEndpoint(fetch);
    expect(listDraftsText(registry)).toContain('没有待审');
    const id = await queueDraft(endpoint, '谢谢喜欢');
    const listed = listDraftsText(registry);
    expect(listed).toContain(`[${id}]`);
    expect(listed).toContain('谢谢喜欢');
    expect(listed).not.toContain('bili-draft send');
    expect(listDraftsText(registry, { formatCommand: path => `!review ${path}` })).toContain('!review bili-draft send <id>');
    expect(editDraftText(registry, id, '谢谢你的喜欢')).toContain('还没发出');
    expect(posts).toHaveLength(0);
    const sent = await approveDraftText(registry, id);
    expect(sent).toContain('已发到 B 站');
    expect(sent).toContain(`https://www.bilibili.com/video/av${AID}#reply9001`);
    expect(await approveDraftText(registry, id)).toContain('找不到草稿');
    const dropped = await queueDraft(endpoint, 'nope');
    expect(discardDraftText(registry, dropped)).toContain('已丢弃');
    expect(posts).toHaveLength(1);
  });

  it('explains rate limits and risk stops in plain words', async () => {
    const { fetch } = fakeFetch({ addCode: -412 });
    const { endpoint, registry } = await makeEndpoint(fetch);
    const id = await queueDraft(endpoint);
    expect(await approveDraftText(registry, id)).toContain('风控熔断');
  });
});

describe('BilibiliEndpoint reply-me / at-me notifications', () => {
  it('does not advance the notification cursor while closed before receiving the same native item after reopen', async () => {
    const incoming = notification(101, { subject_id: AID, root_id: 1, source_id: 3, target_id: 1 });
    const { fetch } = fakeFetch({ feeds: { reply: [[], [incoming]] } });
    const { endpoint, receive } = await makeEndpoint(fetch, { notifications: ['reply'] });
    try {
      await endpoint.endpoint.pollNotificationsOnce();
      await endpoint.close();
      await endpoint.endpoint.pollNotificationsOnce();
      expect(receive).not.toHaveBeenCalled();
      endpoint.open();
      await endpoint.endpoint.pollNotificationsOnce();
      expect(receive).toHaveBeenCalledTimes(1);
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ id: '3' }), mentioned: true }));
    } finally { await endpoint.stop(); }
  });

  it('baselines, then admits new video notifications as mentioned, within the whitelist, once', async () => {
    const old = notification(100, { subject_id: AID, root_id: 1, source_id: 2, target_id: 1 });
    const replyMe = notification(101, { subject_id: AID, root_id: 1, source_id: 3, target_id: 1, source_content: '回复你' });
    const outside = notification(102, { subject_id: 999, root_id: 0, source_id: 4, target_id: 0 });
    const atMe = notification(200, { subject_id: AID, root_id: 0, source_id: 7, target_id: 0, source_content: '@up 看这里' }, 66);
    const dynamic = notification(201, { business_id: 17, subject_id: 1, source_id: 8 });
    const { fetch } = fakeFetch({
      pages: [[]],
      feeds: { reply: [[old], [old, replyMe, outside]], at: [[], [atMe, dynamic]] },
    });
    const { endpoint, receive } = await makeEndpoint(fetch, { notifications: ['reply', 'at'] });
    await endpoint.start();
    endpoint.open();
    await endpoint.endpoint.pollOnce();
    expect(receive).not.toHaveBeenCalled();

    await endpoint.endpoint.pollOnce();
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenNthCalledWith(1, expect.objectContaining({
      conversation: expect.objectContaining({ id: `video:${AID}:1` }),
      message: expect.objectContaining({ id: '3' }),
      content: '回复你',
      mentioned: true,
      replyTo: { id: '1' },
      metadata: expect.objectContaining({ via: 'reply' }),
    }));
    expect(receive).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversation: expect.objectContaining({ id: `video:${AID}:7` }),
      sender: { id: '66', name: 'u66' },
      mentioned: true,
      metadata: expect.objectContaining({ via: 'at' }),
    }));

    await endpoint.endpoint.pollOnce();
    expect(receive).toHaveBeenCalledTimes(2);
    await endpoint.stop();
  });

  it('accepts notifications outside the whitelist only with notificationScope=all', async () => {
    const outside = notification(102, { subject_id: 999, root_id: 0, source_id: 4, target_id: 0 });
    const { fetch } = fakeFetch({ pages: [[]], feeds: { reply: [[], [outside]] } });
    const { endpoint, receive } = await makeEndpoint(fetch, { notifications: ['reply'], notificationScope: 'all' });
    await endpoint.start();
    endpoint.open();
    await endpoint.endpoint.pollOnce();
    await endpoint.endpoint.pollOnce();
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ id: 'video:999:4' }),
    }));
    await endpoint.stop();
  });

  it('does not double-admit a comment seen by both the video poll and a notification', async () => {
    const dup = reply(3, { root: 1, parent: 1, mid: 55 });
    const { fetch } = fakeFetch({
      pages: [[reply(1)], [reply(1), dup]],
      feeds: { reply: [[], [notification(101, { subject_id: AID, root_id: 1, source_id: 3, target_id: 1 })]] },
    });
    const { endpoint, receive } = await makeEndpoint(fetch, { notifications: ['reply'] });
    await endpoint.start();
    endpoint.open();
    await endpoint.endpoint.pollOnce();
    await endpoint.endpoint.pollOnce();
    expect(receive).toHaveBeenCalledTimes(1);
    await endpoint.stop();
  });

  it('skips notification polling when not configured', async () => {
    const { fetch, calls } = fakeFetch({ pages: [[]] });
    const { endpoint } = await makeEndpoint(fetch);
    await endpoint.start();
    await endpoint.endpoint.pollOnce();
    expect(calls.some((url) => url.includes('/x/msgfeed/'))).toBe(false);
    await endpoint.stop();
  });
});
