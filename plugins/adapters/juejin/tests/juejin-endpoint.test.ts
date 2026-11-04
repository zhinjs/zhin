import { mkdtempSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { createTestEventGateway } from '../../test-utils/endpoint.js';
import { createJuejinHarness } from './juejin-harness.js';
import { ARTICLE, SELF_UID, comment, fakeFetch, type FakeOptions } from './juejin-fake.js';
import { JuejinReviewError } from '../src/endpoint.js';
import type { JuejinEndpointConfig } from '../src/protocol.js';

const OTHER_ARTICLE = '7005444889106186270';
const thread = (root: string, article = ARTICLE) => ({ endpoint: { id: 'e', adapter: 'juejin' }, kind: 'channel' as const, id: `article:${article}:${root}` });

async function setup(options: FakeOptions = {}, config: Partial<JuejinEndpointConfig> = {}, extra: { stateDir?: string; clock?: { now: number } } = {}) {
  const fake = fakeFetch(options);
  const receive = vi.fn(async () => undefined);
  const clock = extra.clock ?? { now: 1_000_000 };
  const harness = await createJuejinHarness({ id: 'jj', articles: [ARTICLE], cookie: 'sessionid=offline', ...config },
    { fetch: fake.fetch, now: () => clock.now, ...(extra.stateDir ? { stateDir: extra.stateDir } : {}) }, createTestEventGateway({ receive }));
  return { ...fake, harness, endpoint: harness.endpoint, receive, clock };
}

describe('JuejinEndpoint inbound', () => {
  it('baselines the first poll, then admits only new comments and replies per thread', async () => {
    const first = [comment('7000000000000000100')];
    const second = [comment('7000000000000000300'), comment('7000000000000000100', {
      replies: [{ id: '7000000000000000200' }, { id: '7000000000000000250', to: '7000000000000000200' }] })];
    const { endpoint, receive, harness, listBodies } = await setup({ pages: [first, second] });
    expect(harness.index.connection('juejin', harness.canonicalId)?.selfUserId).toBe(SELF_UID);
    await endpoint.pollOnce();
    expect(receive).not.toHaveBeenCalled();
    expect(listBodies[0]).toEqual({ item_id: ARTICLE, item_type: 2, cursor: '0', limit: 20, sort: 0, client_type: 2608 });

    await endpoint.pollOnce();
    expect(receive.mock.calls.map(([event]) => [(event as { message: { id: string } }).message.id, (event as { conversation: { id: string } }).conversation.id])).toEqual([
      ['7000000000000000200', `article:${ARTICLE}:7000000000000000100`],
      ['7000000000000000250', `article:${ARTICLE}:7000000000000000100`],
      ['7000000000000000300', `article:${ARTICLE}:7000000000000000300`],
    ]);
    expect(receive).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'channel', parent: { kind: 'channel', id: `article:${ARTICLE}` } }),
      replyTo: { id: '7000000000000000200' },
      sender: { id: '1000000000000002', name: 'replier' },
      metadata: expect.objectContaining({ rootId: '7000000000000000100', parentId: '7000000000000000200', kind: 'reply' }),
    }));

    // 同一批评论再次出现：按 id 去重，不重复入站
    await endpoint.pollOnce();
    expect(receive).toHaveBeenCalledTimes(3);
  });

  it('filters self comments by login uid and by the platform author flag', async () => {
    const { endpoint, receive } = await setup({ pages: [[], [
      comment('7000000000000000401', { user: SELF_UID }),
      comment('7000000000000000402', { isAuthor: true, user: '1000000000000009' }),
      comment('7000000000000000403', { replies: [{ id: '7000000000000000404', isAuthor: true }] }),
    ]] });
    await endpoint.pollOnce();
    await endpoint.pollOnce();
    expect(receive.mock.calls.map(([event]) => (event as { message: { id: string } }).message.id)).toEqual(['7000000000000000403']);
  });

  it('polls only whitelisted articles; a blank whitelist polls nothing', async () => {
    const whitelisted = await setup({ pages: [[]] }, { articles: [ARTICLE, `https://juejin.cn/post/${OTHER_ARTICLE}`] });
    await whitelisted.endpoint.pollOnce();
    expect(whitelisted.listBodies.map(body => body.item_id)).toEqual([ARTICLE, OTHER_ARTICLE]);

    const blank = await setup({ pages: [[]] }, { articles: [] });
    await blank.endpoint.pollOnce();
    expect(blank.calls.some(url => url.includes('/comment/list'))).toBe(false);
  });

  it('reads public comments without a cookie and never sends a Cookie header then', async () => {
    const { endpoint, calls, headers } = await setup({ pages: [[]] }, { cookie: undefined });
    expect(endpoint.login.state).toBe('none');
    await endpoint.pollOnce();
    expect(calls.some(url => url.includes('/user/get'))).toBe(false);
    expect(headers.every(header => header.Cookie === undefined)).toBe(true);
    expect(calls.every(url => url.endsWith('aid=2608'))).toBe(true);
  });

  it('marks an invalid cookie as expired without failing to start', async () => {
    const { endpoint } = await setup({ self: null, pages: [[]] });
    expect(endpoint.login.state).toBe('expired');
  });
});

describe('JuejinEndpoint circuit breaker', () => {
  for (const [label, pollError, code] of [
    ['HTTP 429', { status: 429 }, -429],
    ['HTTP 403 gateway block', { status: 403 }, -403],
    ['non-JSON verification page', { body: '<html>verify</html>' }, -2],
    ['risk wording', { errNo: 4000, errMsg: '操作过于频繁，请稍后再试' }, 4000],
    ['captcha wording', { errNo: 4001, errMsg: '请完成验证码' }, 4001],
  ] as const) {
    it(`opens on ${label} and stops polling and sending`, async () => {
      const { endpoint, harness, calls } = await setup({ pages: [[]], pollError });
      await endpoint.pollOnce();
      await endpoint.pollOnce();
      expect(endpoint.circuitBreaker?.code).toBe(code);
      expect(harness.index.describe()[0]?.transportState).toBe('closed');
      const before = calls.length;
      await endpoint.pollOnce();
      expect(calls.length).toBe(before);
      await harness.send({ conversation: thread('7000000000000000100'), payload: 'hi' }).catch(() => undefined);
      const draft = endpoint.drafts.list()[0]!;
      await expect(endpoint.approveDraft(draft.id)).rejects.toMatchObject({ code: 'circuit_open' });
      expect(calls.some(url => url.includes('/reply/publish'))).toBe(false);
    });
  }

  it('does not trip on ordinary platform errors', async () => {
    const { endpoint } = await setup({ pages: [[]], pollError: { errNo: 2, errMsg: '请求路由不存在' } });
    await endpoint.pollOnce();
    await endpoint.pollOnce();
    expect(endpoint.circuitBreaker).toBeUndefined();
  });
});

describe('JuejinEndpoint review-only outbound', () => {
  it('send only queues a draft and never calls the write API', async () => {
    const { harness, endpoint, calls } = await setup({ pages: [[]] });
    const error = await harness.send({ conversation: thread('7000000000000000100'), payload: '感谢支持' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EndpointDeliveryError);
    expect((error as EndpointDeliveryError).code).toBe('approval_pending');
    expect((error as EndpointDeliveryError).disposition).toBe('not_sent');
    expect(endpoint.drafts.list()).toEqual([expect.objectContaining({
      articleId: ARTICLE, root: '7000000000000000100', parent: '7000000000000000100', message: '感谢支持', target: thread('7000000000000000100').id,
    })]);
    expect(calls.some(url => url.includes('/reply/publish'))).toBe(false);
  });

  it('refuses off mode, non-thread targets and articles outside the whitelist', async () => {
    const off = await setup({ pages: [[]] }, { sendMode: 'off' });
    await expect(off.harness.send({ conversation: thread('7000000000000000100'), payload: 'hi' })).rejects.toMatchObject({ code: 'send_disabled' });
    const on = await setup({ pages: [[]] });
    await expect(on.harness.send({ conversation: { ...thread('1'), id: `article:${ARTICLE}` }, payload: 'hi' })).rejects.toMatchObject({ code: 'invalid_recipient' });
    await expect(on.harness.send({ conversation: thread('1', OTHER_ARTICLE), payload: 'hi' })).rejects.toMatchObject({ code: 'invalid_recipient' });
    await expect(on.harness.send({ conversation: thread('1'), payload: '' })).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(off.endpoint.drafts.size + on.endpoint.drafts.size).toBe(0);
  });

  it('keeps a reply segment only when it targets a known reply in the same thread', async () => {
    const page = [comment('7000000000000000100', { replies: [{ id: '7000000000000000200' }] }), comment('7000000000000000900')];
    const { harness, endpoint } = await setup({ pages: [page] });
    await endpoint.pollOnce();
    await harness.send({ conversation: thread('7000000000000000100'), payload: [{ type: 'reply', data: { id: '7000000000000000200' } }, { type: 'text', data: { text: 'a' } }] }).catch(() => undefined);
    await harness.send({ conversation: thread('7000000000000000100'), payload: [{ type: 'reply', data: { id: '7000000000000000900' } }, { type: 'text', data: { text: 'b' } }] }).catch(() => undefined);
    expect(endpoint.drafts.list().map(draft => [draft.parent, draft.context?.author])).toEqual([
      ['7000000000000000200', 'replier'],
      ['7000000000000000100', 'reader'],
    ]);
  });

  it('approves a draft with the community reply/publish body and enforces the send interval', async () => {
    const clock = { now: 1_000_000 };
    const { harness, endpoint, posts } = await setup({ pages: [[]] }, {}, { clock });
    await harness.send({ conversation: thread('7000000000000000100'), payload: '一楼回复' }).catch(() => undefined);
    await harness.send({ conversation: thread('7000000000000000100'), payload: [{ type: 'reply', data: { id: '7000000000000000100' } }, { type: 'text', data: { text: '二条' } }] }).catch(() => undefined);
    const [first, second] = endpoint.drafts.list();
    const sent = await endpoint.approveDraft(first!.id);
    expect(sent.replyId).toBe('7400000000000000002');
    expect(posts[0]).toEqual({ client_type: 2608, item_id: ARTICLE, item_type: 2, reply_content: '一楼回复', reply_pics: [],
      reply_to_comment_id: '7000000000000000100' });
    await expect(endpoint.approveDraft(second!.id)).rejects.toMatchObject({ code: 'rate_limited' });
    clock.now += 30_000;
    await endpoint.approveDraft(second!.id);
    expect(posts).toHaveLength(2);
    expect(endpoint.drafts.size).toBe(0);
  });

  it('sends reply_to_reply_id when the draft answers a floor reply', async () => {
    const page = [comment('7000000000000000100', { replies: [{ id: '7000000000000000200' }] })];
    const { harness, endpoint, posts } = await setup({ pages: [page] });
    await endpoint.pollOnce();
    await harness.send({ conversation: thread('7000000000000000100'), payload: [{ type: 'reply', data: { id: '7000000000000000200' } }, { type: 'text', data: { text: 'hi' } }] }).catch(() => undefined);
    await endpoint.approveDraft(endpoint.drafts.list()[0]!.id);
    expect(posts[0]).toMatchObject({ reply_to_comment_id: '7000000000000000100', reply_to_reply_id: '7000000000000000200' });
  });

  it('refuses approval without a valid login and keeps the draft', async () => {
    const { harness, endpoint, calls } = await setup({ self: null, pages: [[]] });
    await harness.send({ conversation: thread('7000000000000000100'), payload: 'hi' }).catch(() => undefined);
    const id = endpoint.drafts.list()[0]!.id;
    await expect(endpoint.approveDraft(id)).rejects.toBeInstanceOf(JuejinReviewError);
    await expect(endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'no_cookie' });
    expect(endpoint.drafts.get(id)).toBeDefined();
    expect(calls.some(url => url.includes('/reply/publish'))).toBe(false);
  });

  it('marks the draft as possibly posted when the write outcome is unknown', async () => {
    for (const publish of [{ body: '' }, { throws: true }]) {
      const { harness, endpoint, posts } = await setup({ pages: [[]], publish });
      await harness.send({ conversation: thread('7000000000000000100'), payload: 'hi' }).catch(() => undefined);
      const id = endpoint.drafts.list()[0]!.id;
      await expect(endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'unknown_outcome' });
      expect(posts).toHaveLength(1);
      expect(endpoint.drafts.get(id)).toMatchObject({ status: 'pending', interrupted: true });
    }
  });

  it('trips the breaker when the write hits a verification page', async () => {
    const { harness, endpoint } = await setup({ pages: [[]], publish: { body: '<html>captcha</html>' } });
    await harness.send({ conversation: thread('7000000000000000100'), payload: 'hi' }).catch(() => undefined);
    const id = endpoint.drafts.list()[0]!.id;
    await expect(endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'circuit_open' });
    expect(endpoint.circuitBreaker?.code).toBe(-2);
    expect(endpoint.drafts.get(id)).toMatchObject({ interrupted: true });
  });

  it('marks the login expired on err_no 403 from the write API', async () => {
    const { harness, endpoint } = await setup({ pages: [[]], publish: { body: '{"err_no":403,"err_msg":"must login","data":null}' } });
    await harness.send({ conversation: thread('7000000000000000100'), payload: 'hi' }).catch(() => undefined);
    const id = endpoint.drafts.list()[0]!.id;
    await expect(endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'no_cookie' });
    expect(endpoint.login.state).toBe('expired');
    expect(endpoint.circuitBreaker).toBeUndefined();
    expect(endpoint.drafts.get(id)).toMatchObject({ status: 'pending' });
    expect(endpoint.drafts.get(id)?.interrupted).toBeUndefined();
  });
});

describe('JuejinEndpoint draft persistence', () => {
  it('persists drafts with mode 600 and restores an interrupted send as possibly posted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'juejin-drafts-'));
    try {
      const first = await setup({ pages: [[]] }, {}, { stateDir: directory });
      await first.harness.send({ conversation: thread('7000000000000000100'), payload: '待审' }).catch(() => undefined);
      const id = first.endpoint.drafts.list()[0]!.id;
      first.endpoint.drafts.update(id, { status: 'sending' });
      const [stateDirectory] = readdirSync(directory);
      const file = join(directory, stateDirectory!, 'drafts.json');
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(file, 'utf8')).not.toContain('sessionid');
      await first.harness.stop();

      const second = await setup({ pages: [[]] }, {}, { stateDir: directory });
      expect(second.endpoint.drafts.get(id)).toMatchObject({ status: 'pending', interrupted: true, message: '待审' });
      second.endpoint.editDraft(id, '改过了');
      expect(second.endpoint.drafts.get(id)?.interrupted).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
