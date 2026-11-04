/**
 * #971 B1：动态（type 11 / 17）与专栏（type 12）评论区。全部离线：fetch 由夹具提供，不访问真实网络。
 */
import { createTestEventGateway } from '../../test-utils/endpoint.js';
import { createBilibiliHarness } from './bilibili-harness.js';
import { describe, expect, it, vi } from 'vitest';
import {
  commentAreaUrl,
  notificationToComment,
  parseArticleRef,
  parseDynamicRef,
  parseThreadConversationId,
  resolveBilibiliConfig,
  resolveDynamicCommentArea,
  type BilibiliDynamicDetail,
  type BilibiliNotificationItem,
  type BilibiliReply,
} from '../src/protocol.js';
import type { BilibiliFetch } from '../src/client.js';
import { formatDraft } from '../src/review.js';

/** 纯文字动态：评论区 type=17，oid = 动态 id 本身（19 位，超过 2^53）。 */
const TEXT_DYN = '1073543151725051921';
/** 带图动态：评论区 type=11，oid = 相簿 id，与动态 id 不同。 */
const DRAW_DYN = '967717348014293017';
const ALBUM_ID = '326122895';
/** 视频动态：不在 dynamics 里处理。 */
const AV_DYN = '718390979031203873';
/** 已删除 / 不可见的动态。 */
const GONE_DYN = '718384798557536290';
const CVID = '40000001';

const DETAILS: Record<string, BilibiliDynamicDetail> = {
  [TEXT_DYN]: { item: { id_str: TEXT_DYN, type: 'DYNAMIC_TYPE_WORD', basic: { comment_type: 17, comment_id_str: TEXT_DYN, rid_str: '' } } },
  [DRAW_DYN]: { item: { id_str: DRAW_DYN, type: 'DYNAMIC_TYPE_DRAW', basic: { comment_type: 11, comment_id_str: ALBUM_ID, rid_str: ALBUM_ID } } },
  [AV_DYN]: { item: { id_str: AV_DYN, type: 'DYNAMIC_TYPE_AV', basic: { comment_type: 1, comment_id_str: '170001', rid_str: '170001' } } },
};

function reply(rpid: number, extra: Partial<BilibiliReply> = {}): BilibiliReply {
  return {
    rpid, oid: 0, type: 17, mid: 42, root: 0, parent: 0, ctime: rpid,
    member: { mid: '42', uname: 'viewer' }, content: { message: `comment ${rpid}` },
    ...extra,
  };
}

function notification(id: number, item: BilibiliNotificationItem['item'], mid = 55): BilibiliNotificationItem {
  return { id, user: { mid, nickname: `u${mid}` }, item: { type: 'reply', ...item }, reply_time: id };
}

interface FakeOptions {
  /** `type:oid` → 依次返回的评论页。 */
  readonly pages?: Record<string, BilibiliReply[][]>;
  readonly feeds?: Partial<Record<'reply' | 'at', BilibiliNotificationItem[][]>>;
  readonly detailCode?: number;
  readonly riskOnSecondPoll?: number;
}

function fakeFetch(options: FakeOptions = {}) {
  const pageCalls: Record<string, number> = {};
  const feedCalls: Record<string, number> = { reply: 0, at: 0 };
  const posts: Array<Record<string, string>> = [];
  const calls: string[] = [];
  const fetch: BilibiliFetch = vi.fn(async (url: string, init) => {
    calls.push(url);
    const ok = (data: unknown, code = 0) => ({ ok: true, status: 200, json: async () => ({ code, data }) });
    if (url.includes('/x/web-interface/nav')) return ok({ isLogin: true, mid: 99 });
    if (url.includes('/x/polymer/web-dynamic/v1/detail?')) {
      if (options.detailCode !== undefined) return ok(null, options.detailCode);
      const id = new URL(url).searchParams.get('id') ?? '';
      const detail = DETAILS[id];
      return detail ? ok(detail) : ok(null, 4101131);
    }
    if (url.includes('/x/v2/reply/add')) {
      posts.push(Object.fromEntries(new URLSearchParams(init?.body ?? '')));
      return ok({ rpid: 9001, rpid_str: '9001' });
    }
    if (url.includes('/x/v2/reply?')) {
      const query = new URL(url).searchParams;
      const key = `${query.get('type')}:${query.get('oid')}`;
      const call = pageCalls[key] ?? 0;
      pageCalls[key] = call + 1;
      if (options.riskOnSecondPoll !== undefined && call > 0) return ok(null, options.riskOnSecondPoll);
      const pages = options.pages?.[key] ?? [[]];
      return ok({ replies: pages[Math.min(call, pages.length - 1)] ?? [], upper: { mid: 99 } });
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

async function makeEndpoint(fetch: BilibiliFetch, config: Record<string, unknown> = {}) {
  const receive = vi.fn(async (_event: unknown) => undefined);
  const endpoint = await createBilibiliHarness({ id: 'bili', sessdata: 's', biliJct: 'csrf-token', ...config },
    { fetch, now: () => 1_000_000 }, createTestEventGateway({ receive }));
  return { endpoint, receive };
}

describe('bilibili dynamic / article protocol', () => {
  it('parses dynamic, album and article thread ids without losing 19-digit oids', () => {
    expect(parseThreadConversationId(`dynamic:${TEXT_DYN}:265141324256`))
      .toEqual({ type: 'dynamic', commentType: 17, oid: TEXT_DYN, root: '265141324256' });
    expect(parseThreadConversationId(`album:${ALBUM_ID}:5`)).toEqual({ type: 'album', commentType: 11, oid: ALBUM_ID, root: '5' });
    expect(parseThreadConversationId(`article:${CVID}:7`)).toEqual({ type: 'article', commentType: 12, oid: CVID, root: '7' });
    expect(parseThreadConversationId('video:170001:99')).toMatchObject({ type: 'video', commentType: 1 });
    expect(parseThreadConversationId(`opus:${TEXT_DYN}:1`)).toBeUndefined();
    expect(parseThreadConversationId(`dynamic:${TEXT_DYN}`)).toBeUndefined();
    expect(parseThreadConversationId('article:0:1')).toBeUndefined();
  });

  it('accepts explicit dynamic / article whitelists only, rejecting lossy numbers', () => {
    expect(parseDynamicRef(TEXT_DYN)).toBe(TEXT_DYN);
    expect(() => parseDynamicRef(Number(TEXT_DYN))).toThrow(/precision/);
    expect(() => parseDynamicRef('https://t.bilibili.com/1')).toThrow(/dynamic/);
    expect(parseArticleRef('cv40000001')).toBe(CVID);
    expect(parseArticleRef(40000001)).toBe(CVID);
    expect(() => parseArticleRef('read/cv1')).toThrow(/article/);
    const config = resolveBilibiliConfig({ id: 'x', dynamics: [TEXT_DYN, TEXT_DYN], articles: ['cv1', 1] });
    expect(config.dynamics).toEqual([TEXT_DYN]);
    expect(config.articles).toEqual(['1']);
    expect(resolveBilibiliConfig({ id: 'x' })).toMatchObject({ dynamics: [], articles: [] });
  });

  it('resolves dynamic id → (type, oid) from the platform-declared comment area', () => {
    expect(resolveDynamicCommentArea(TEXT_DYN, DETAILS[TEXT_DYN])).toEqual({
      ok: true, area: { kind: 'dynamic', type: 17, oid: TEXT_DYN, dynamicId: TEXT_DYN },
    });
    // 带图动态：评论区是相簿 id，不是动态 id。
    expect(resolveDynamicCommentArea(DRAW_DYN, DETAILS[DRAW_DYN])).toEqual({
      ok: true, area: { kind: 'album', type: 11, oid: ALBUM_ID, dynamicId: DRAW_DYN },
    });
  });

  it('refuses unsupported or malformed dynamic shapes instead of guessing an oid', () => {
    expect(resolveDynamicCommentArea(AV_DYN, DETAILS[AV_DYN])).toMatchObject({ ok: false, reason: expect.stringMatching(/videos/) });
    expect(resolveDynamicCommentArea('1', { item: { id_str: '1', basic: { comment_type: 12, comment_id_str: '5' } } }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/articles/) });
    expect(resolveDynamicCommentArea('1', { item: { id_str: '1', type: 'DYNAMIC_TYPE_MEDIALIST', basic: { comment_type: 19, comment_id_str: '5' } } }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/unsupported comment type 19/) });
    expect(resolveDynamicCommentArea('1', { item: { id_str: '1', basic: { comment_type: 17, comment_id_str: '' } } })).toMatchObject({ ok: false });
    expect(resolveDynamicCommentArea('1', { item: { id_str: '1' } })).toMatchObject({ ok: false });
    expect(resolveDynamicCommentArea('1', { item: { id_str: '2', basic: { comment_type: 17, comment_id_str: '2' } } }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/does not match/) });
    expect(resolveDynamicCommentArea('1', { item: null })).toMatchObject({ ok: false });
    expect(resolveDynamicCommentArea('1', undefined)).toMatchObject({ ok: false });
  });

  it('maps 11 / 12 / 17 notifications only for enabled kinds and recovers lossy dynamic ids from the link', () => {
    const all = new Set(['video', 'album', 'article', 'dynamic'] as const);
    const text = notification(1, {
      business_id: 17, subject_id: Number(TEXT_DYN), root_id: 0, source_id: 265141324256,
      uri: `https://www.bilibili.com/opus/${TEXT_DYN}#reply265141324256`,
    });
    expect(notificationToComment(text, all)).toMatchObject({ area: { kind: 'dynamic', type: 17, oid: TEXT_DYN }, reply: { rpid: 265141324256 } });
    expect(notificationToComment(text)).toBeUndefined(); // 默认只收视频（v1 行为）
    expect(notificationToComment(notification(2, { business_id: 17, subject_id: Number(TEXT_DYN), source_id: 3 }), all)).toBeUndefined();
    expect(notificationToComment(notification(3, {
      business_id: 17, subject_id: Number(TEXT_DYN), source_id: 3, uri: 'https://www.bilibili.com/opus/1073543151725051999',
    }), all)).toBeUndefined();
    expect(notificationToComment(notification(4, {
      business_id: 17, subject_id: Number(TEXT_DYN), source_id: 3, native_uri: `bilibili://opus/detail/${TEXT_DYN}?comment_root_id=1`,
    }), all)).toMatchObject({ area: { oid: TEXT_DYN } });
    expect(notificationToComment(notification(5, { business_id: 11, subject_id: Number(ALBUM_ID), source_id: 6 }), all))
      .toMatchObject({ area: { kind: 'album', type: 11, oid: ALBUM_ID } });
    expect(notificationToComment(notification(6, { business_id: 12, subject_id: Number(CVID), source_id: 7 }), all))
      .toMatchObject({ area: { kind: 'article', type: 12, oid: CVID } });
    expect(notificationToComment(notification(7, { business_id: 12, subject_id: Number(CVID), source_id: 7 }), new Set(['video', 'dynamic'] as const)))
      .toBeUndefined();
    expect(notificationToComment(notification(8, { business_id: 19, subject_id: 5, source_id: 7 }), all)).toBeUndefined();
  });

  it('builds review links per comment area', () => {
    expect(commentAreaUrl({ type: 12, oid: CVID }, '1')).toBe(`https://www.bilibili.com/read/cv${CVID}#reply1`);
    expect(commentAreaUrl({ type: 17, oid: TEXT_DYN }, '1')).toBe(`https://t.bilibili.com/${TEXT_DYN}#reply1`);
    expect(commentAreaUrl({ type: 11, oid: ALBUM_ID, dynamicId: DRAW_DYN }, '1')).toBe(`https://t.bilibili.com/${DRAW_DYN}#reply1`);
    expect(commentAreaUrl({ oid: '170001' }, '1')).toBe('https://www.bilibili.com/video/av170001#reply1');
  });
});

describe('BilibiliEndpoint dynamic / article comment areas', () => {
  it('resolves whitelisted dynamics before polling, skipping unsupported ones', async () => {
    const { fetch, calls } = fakeFetch();
    const { endpoint } = await makeEndpoint(fetch, { dynamics: [TEXT_DYN, DRAW_DYN, AV_DYN, GONE_DYN], articles: [`cv${CVID}`] });
    expect(endpoint.endpoint.commentAreas).toEqual([
      { kind: 'dynamic', type: 17, oid: TEXT_DYN, dynamicId: TEXT_DYN },
      { kind: 'album', type: 11, oid: ALBUM_ID, dynamicId: DRAW_DYN },
      { kind: 'article', type: 12, oid: CVID },
    ]);
    expect(endpoint.endpoint.resources).toEqual([
      expect.objectContaining({ kind: 'dynamic', ref: TEXT_DYN, area: { kind: 'dynamic', type: 17, oid: TEXT_DYN } }),
      expect.objectContaining({ kind: 'dynamic', ref: DRAW_DYN, area: { kind: 'album', type: 11, oid: ALBUM_ID } }),
      expect.objectContaining({ kind: 'dynamic', ref: AV_DYN, error: expect.stringMatching(/videos/) }),
      expect.objectContaining({ kind: 'dynamic', ref: GONE_DYN, error: 'code 4101131' }),
      expect.objectContaining({ kind: 'article', ref: CVID, url: `https://www.bilibili.com/read/cv${CVID}` }),
    ]);
    await endpoint.endpoint.pollOnce();
    const polled = calls.filter(url => url.includes('/x/v2/reply?')).map(url => {
      const query = new URL(url).searchParams;
      return `${query.get('type')}:${query.get('oid')}`;
    });
    expect(polled).toEqual([`17:${TEXT_DYN}`, `11:${ALBUM_ID}`, `12:${CVID}`]);
    await endpoint.stop();
  });

  it('does not poll a kind whose whitelist is blank', async () => {
    const { fetch, calls } = fakeFetch();
    const { endpoint } = await makeEndpoint(fetch, { videos: ['170001'] });
    await endpoint.endpoint.pollOnce();
    expect(calls.some(url => url.includes('/web-dynamic/'))).toBe(false);
    expect(calls.filter(url => url.includes('/x/v2/reply?')).every(url => url.includes('type=1&'))).toBe(true);
    await endpoint.stop();
  });

  it('baselines each area, then admits new comments as resource threads', async () => {
    const { fetch } = fakeFetch({
      pages: {
        [`17:${TEXT_DYN}`]: [[reply(1)], [reply(1), reply(2, { root: 1, parent: 1, oid: Number(TEXT_DYN) })]],
        [`11:${ALBUM_ID}`]: [[], [reply(3, { type: 11 })]],
        [`12:${CVID}`]: [[], [reply(4, { type: 12, mid: 99 }), reply(5, { type: 12 })]],
      },
    });
    const { endpoint, receive } = await makeEndpoint(fetch, { dynamics: [TEXT_DYN, DRAW_DYN], articles: [CVID] });
    await endpoint.endpoint.pollOnce();
    expect(receive).not.toHaveBeenCalled();
    await endpoint.endpoint.pollOnce();
    expect(receive).toHaveBeenCalledTimes(3);
    expect(receive).toHaveBeenNthCalledWith(1, expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'channel', id: `dynamic:${TEXT_DYN}:1`, parent: { kind: 'channel', id: `dynamic:${TEXT_DYN}` } }),
      message: expect.objectContaining({ id: '2' }),
      metadata: expect.objectContaining({ via: 'dynamic', resource: expect.objectContaining({ type: 'dynamic', oid: TEXT_DYN, commentType: 17 }) }),
    }));
    expect(receive.mock.calls[0]![0]).not.toHaveProperty('mentioned');
    expect(receive).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversation: expect.objectContaining({ id: `album:${ALBUM_ID}:3`, parent: { kind: 'channel', id: `album:${ALBUM_ID}` } }),
      metadata: expect.objectContaining({ via: 'album', resource: expect.objectContaining({ commentType: 11, dynamicId: DRAW_DYN }) }),
    }));
    expect(receive).toHaveBeenNthCalledWith(3, expect.objectContaining({
      conversation: expect.objectContaining({ id: `article:${CVID}:5` }),
    }));
    await endpoint.stop();
  });

  it('filters 11 / 12 / 17 notifications by whitelist and enabled kinds', async () => {
    const onText = notification(101, { business_id: 17, subject_id: Number(TEXT_DYN), root_id: 0, source_id: 11,
      uri: `https://www.bilibili.com/opus/${TEXT_DYN}#reply11` });
    const onAlbum = notification(102, { business_id: 11, subject_id: Number(ALBUM_ID), root_id: 0, source_id: 12 });
    const otherDynamic = notification(103, { business_id: 17, subject_id: Number('718377531474968613'), root_id: 0, source_id: 13,
      uri: 'https://t.bilibili.com/718377531474968613' });
    const article = notification(104, { business_id: 12, subject_id: Number(CVID), root_id: 0, source_id: 14 });
    const { fetch } = fakeFetch({ feeds: { reply: [[], [onText, onAlbum, otherDynamic, article]] } });
    const { endpoint, receive } = await makeEndpoint(fetch, { dynamics: [TEXT_DYN, DRAW_DYN], notifications: ['reply'] });
    await endpoint.endpoint.pollOnce();
    await endpoint.endpoint.pollOnce();
    expect(receive.mock.calls.map(([event]) => (event as { conversation: { id: string } }).conversation.id)).toEqual([
      `dynamic:${TEXT_DYN}:11`,
      `album:${ALBUM_ID}:12`,
    ]);
    expect(receive).toHaveBeenNthCalledWith(1, expect.objectContaining({ mentioned: true, metadata: expect.objectContaining({ via: 'reply' }) }));
    await endpoint.stop();
  });

  it('with notificationScope=all accepts other dynamics only when dynamics are configured', async () => {
    const otherDynamic = notification(103, { business_id: 17, subject_id: Number('718377531474968613'), root_id: 0, source_id: 13,
      uri: 'https://t.bilibili.com/718377531474968613' });
    const article = notification(104, { business_id: 12, subject_id: Number(CVID), root_id: 0, source_id: 14 });
    const withDynamics = fakeFetch({ feeds: { reply: [[], [otherDynamic, article]] } });
    const first = await makeEndpoint(withDynamics.fetch, { dynamics: [TEXT_DYN], notifications: ['reply'], notificationScope: 'all' });
    await first.endpoint.endpoint.pollOnce();
    await first.endpoint.endpoint.pollOnce();
    expect(first.receive.mock.calls.map(([event]) => (event as { conversation: { id: string } }).conversation.id))
      .toEqual(['dynamic:718377531474968613:13']);
    await first.endpoint.stop();

    const videosOnly = fakeFetch({ feeds: { reply: [[], [otherDynamic, article]] } });
    const second = await makeEndpoint(videosOnly.fetch, { videos: ['170001'], notifications: ['reply'], notificationScope: 'all' });
    await second.endpoint.endpoint.pollOnce();
    await second.endpoint.endpoint.pollOnce();
    expect(second.receive).not.toHaveBeenCalled();
    await second.endpoint.stop();
  });

  it('send() on a dynamic thread only queues; approval posts the exact (type, oid)', async () => {
    const { fetch, calls, posts } = fakeFetch();
    const { endpoint } = await makeEndpoint(fetch, { dynamics: [TEXT_DYN, DRAW_DYN] });
    const conversation = { endpoint: { id: 'e', adapter: 'bilibili' }, kind: 'channel' as const, id: `dynamic:${TEXT_DYN}:265141324256` };
    await expect(endpoint.send({ conversation, payload: '谢谢' })).rejects.toMatchObject({ code: 'approval_pending', disposition: 'not_sent' });
    await expect(endpoint.send({ conversation: { ...conversation, id: `album:${ALBUM_ID}:7` }, payload: '收到' }))
      .rejects.toMatchObject({ code: 'approval_pending' });
    expect(calls.some(url => url.includes('/x/v2/reply/add'))).toBe(false);
    const [text, album] = endpoint.endpoint.drafts.list();
    expect(text).toMatchObject({ type: 17, oid: TEXT_DYN, root: '265141324256', parent: '265141324256', dynamicId: TEXT_DYN });
    expect(album).toMatchObject({ type: 11, oid: ALBUM_ID, root: '7', dynamicId: DRAW_DYN });
    expect(formatDraft(album!)).toContain(`https://t.bilibili.com/${DRAW_DYN}#reply7`);

    await endpoint.endpoint.approveDraft(text!.id);
    expect(posts).toEqual([{ type: '17', oid: TEXT_DYN, root: '265141324256', parent: '265141324256', message: '谢谢', csrf: 'csrf-token' }]);
    await endpoint.stop();
  });

  it('review mode on an article thread never hits the write API; sendMode off refuses', async () => {
    const { fetch, calls } = fakeFetch();
    const { endpoint } = await makeEndpoint(fetch, { articles: [CVID], sendMode: 'off' });
    const conversation = { endpoint: { id: 'e', adapter: 'bilibili' }, kind: 'channel' as const, id: `article:${CVID}:9` };
    await expect(endpoint.send({ conversation, payload: 'hi' })).rejects.toMatchObject({ code: 'send_disabled' });
    await expect(endpoint.send({ conversation: { ...conversation, id: `article:${CVID}` }, payload: 'hi' }))
      .rejects.toMatchObject({ code: 'invalid_recipient' });
    expect(endpoint.endpoint.drafts.list()).toHaveLength(0);
    expect(calls.some(url => url.includes('/x/v2/reply/add'))).toBe(false);
    await endpoint.stop();
  });

  it('fails start on transient HTTP errors from dynamic detail instead of skipping the dynamic', async () => {
    const fetch: BilibiliFetch = vi.fn(async (url: string) => {
      if (url.includes('/x/web-interface/nav')) return { ok: true, status: 200, json: async () => ({ code: 0, data: { isLogin: true, mid: 99 } }) };
      if (url.includes('/web-dynamic/')) return { ok: false, status: 502, json: async () => ({}) };
      throw new Error(`unexpected ${url}`);
    });
    await expect(makeEndpoint(fetch, { dynamics: [TEXT_DYN] })).rejects.toThrow(/502/);
  });

  it('trips the circuit breaker on risk codes from dynamic detail', async () => {
    const { fetch, calls } = fakeFetch({ detailCode: -352 });
    const { endpoint } = await makeEndpoint(fetch, { dynamics: [TEXT_DYN, DRAW_DYN], articles: [CVID] });
    expect(endpoint.endpoint.circuitBreaker?.code).toBe(-352);
    expect(calls.filter(url => url.includes('/web-dynamic/'))).toHaveLength(1);
    const before = calls.length;
    await endpoint.endpoint.pollOnce();
    expect(calls.length).toBe(before);
    await endpoint.stop();
  });

  it('trips the circuit breaker on risk codes while polling an article', async () => {
    const { fetch, calls } = fakeFetch({ riskOnSecondPoll: -412 });
    const { endpoint } = await makeEndpoint(fetch, { articles: [CVID] });
    await endpoint.endpoint.pollOnce();
    await endpoint.endpoint.pollOnce();
    expect(endpoint.endpoint.circuitBreaker?.code).toBe(-412);
    const before = calls.length;
    await endpoint.endpoint.pollOnce();
    expect(calls.length).toBe(before);
    await endpoint.stop();
  });
});
