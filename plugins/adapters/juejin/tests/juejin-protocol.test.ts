import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  JUEJIN_COMMENT_MAX_LENGTH,
  flattenComments,
  formatOutboundText,
  juejinThreadConversation,
  outboundReplyTarget,
  parseArticleRef,
  parseThreadConversationId,
  resolveJuejinConfig,
  threadConversationId,
  validateReplyText,
  type JuejinApiEnvelope,
  type JuejinCommentEntry,
} from '../src/protocol.js';
import { JuejinApiError } from '../src/client.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/comment-list.json', import.meta.url), 'utf8')) as JuejinApiEnvelope<JuejinCommentEntry[]>;
const ARTICLE = '7129482663794049032';

describe('juejin conversation ids', () => {
  it('round-trips article:<articleId>:<rootCommentId> and keeps 19-digit ids as strings', () => {
    const id = threadConversationId(ARTICLE, '7130214179860595487');
    expect(id).toBe('article:7129482663794049032:7130214179860595487');
    expect(parseThreadConversationId(id)).toEqual({ articleId: ARTICLE, root: '7130214179860595487' });
    expect(juejinThreadConversation('juejin', ARTICLE, '7130214179860595487')).toMatchObject({
      kind: 'channel', id, parent: { kind: 'channel', id: `article:${ARTICLE}` },
    });
  });

  it('rejects resource ids, foreign prefixes and non-decimal ids', () => {
    for (const bad of [`article:${ARTICLE}`, `video:1:2`, `article:abc:1`, `article:${ARTICLE}:0`, `article:0:1`, `pin:${ARTICLE}:1`, `article:${ARTICLE}:1:2`]) {
      expect(parseThreadConversationId(bad)).toBeUndefined();
    }
  });
});

describe('juejin config', () => {
  it('accepts article ids and post links, dedupes, and keeps the whitelist explicit', () => {
    const config = resolveJuejinConfig({ id: 'jj', articles: [ARTICLE, `https://juejin.cn/post/${ARTICLE}?searchId=x#heading-1`, '7005444889106186270'] });
    expect(config.articles).toEqual([ARTICLE, '7005444889106186270']);
    expect(resolveJuejinConfig({ id: 'jj' }).articles).toEqual([]);
    expect(() => parseArticleRef('https://juejin.cn/user/123')).toThrow(/article/);
    expect(() => parseArticleRef('https://evil.example/post/7129482663794049032')).toThrow();
    expect(() => parseArticleRef(Number('7129482663794049032'))).toThrow(/precision/);
    expect(parseArticleRef(123)).toBe('123');
  });

  it('defaults to review, clamps intervals, rejects auto and multi-line cookies', () => {
    const config = resolveJuejinConfig({ id: 'jj', pollIntervalSec: 5, minSendIntervalSec: 1, cookie: '  sessionid=abc  ' });
    expect(config.sendMode).toBe('review');
    expect(config.pollIntervalMs).toBe(60_000);
    expect(config.minSendIntervalMs).toBe(10_000);
    expect(config.cookie).toBe('sessionid=abc');
    expect(config.dataDir).toBe('data/juejin');
    expect(config.apiBaseUrl).toBe('https://api.juejin.cn');
    expect(() => resolveJuejinConfig({ id: 'jj', sendMode: 'auto' as never })).toThrow(/review/);
    expect(() => resolveJuejinConfig({ id: 'jj', cookie: 'sessionid=a\r\nX-Evil: 1' })).toThrow(/single line/);
    expect(() => resolveJuejinConfig({ id: ' ' })).toThrow(/id/);
  });
});

describe('juejin comment/list fixture', () => {
  it('flattens top-level comments and inline replies from a real (anonymized) response', () => {
    const comments = flattenComments(ARTICLE, fixture.data);
    expect(comments.map(comment => [comment.kind, comment.id, comment.rootId, comment.parentId])).toEqual([
      ['comment', '7323011473091969843', '7323011473091969843', '7323011473091969843'],
      ['comment', '7130214179860595487', '7130214179860595487', '7130214179860595487'],
      // 顶层 reply_id 是丢了精度的 JSON number，必须用 reply_info.reply_id 的字符串
      ['reply', '7130237737135244068', '7130214179860595487', '7130214179860595487'],
      ['comment', '7130150522095125261', '7130150522095125261', '7130150522095125261'],
      ['reply', '7130196494040253214', '7130150522095125261', '7130150522095125261'],
    ]);
    expect(comments[2]).toMatchObject({ userId: '1000000000000003', userName: 'reader-c', isAuthor: true, ctime: 1660137912 });
    expect(comments[0]).toMatchObject({ text: '文章里的抽奖地址在哪里？', isAuthor: false });
  });

  it('drops entries from another article or with malformed ids instead of guessing', () => {
    const entries: JuejinCommentEntry[] = [
      { comment_id: '1', comment_info: { comment_id: '1', user_id: '9', item_id: '999', comment_content: 'x', ctime: 1 } },
      { comment_id: 'abc', comment_info: { comment_id: 'abc', user_id: '9', item_id: ARTICLE, ctime: 1 } },
      { comment_id: '2', comment_info: { comment_id: '2', user_id: '9', item_id: ARTICLE, ctime: 2 },
        reply_infos: [{ reply_info: { reply_id: '3', reply_comment_id: '999', user_id: '9', item_id: ARTICLE } },
          { reply_info: { reply_id: '4', reply_comment_id: '2', user_id: '9', reply_to_reply_id: '5', item_id: ARTICLE } }] },
    ];
    expect(flattenComments(ARTICLE, entries).map(comment => [comment.id, comment.parentId])).toEqual([['2', '2'], ['4', '5']]);
    expect(flattenComments(ARTICLE, null)).toEqual([]);
  });
});

describe('juejin outbound text', () => {
  it('formats plain text, mentions and validates length', () => {
    expect(formatOutboundText([{ type: 'text', data: { text: '谢谢' } }, { type: 'mention', data: { name: 'a' } }, { type: 'image', data: {} }])).toBe('谢谢@a');
    expect(outboundReplyTarget([{ type: 'reply', data: { id: '7130237737135244068' } }])).toBe('7130237737135244068');
    expect(outboundReplyTarget([{ type: 'reply', data: { id: 'x' } }])).toBeUndefined();
    expect(validateReplyText('')).toMatch(/Empty/);
    expect(validateReplyText('a'.repeat(JUEJIN_COMMENT_MAX_LENGTH + 1))).toMatch(/exceeds/);
    expect(validateReplyText('好')).toBeUndefined();
  });
});

describe('juejin risk classification', () => {
  it('treats HTTP 403/429, non-JSON and risk wording as circuit-breaking, but err_no 403 as login required', () => {
    expect(new JuejinApiError(-429, 'Juejin HTTP 429', { httpStatus: 429 }).risk).toBe(true);
    expect(new JuejinApiError(-403, 'Juejin HTTP 403', { httpStatus: 403 }).risk).toBe(true);
    expect(new JuejinApiError(-2, 'non-JSON').risk).toBe(true);
    expect(new JuejinApiError(7, 'Juejin API 7: 操作过于频繁').risk).toBe(true);
    expect(new JuejinApiError(8, 'Juejin API 8: 请完成验证码').risk).toBe(true);
    const login = new JuejinApiError(403, 'Juejin API 403: must login');
    expect(login.risk).toBe(false);
    expect(login.loginRequired).toBe(true);
    expect(new JuejinApiError(2, 'Juejin API 2: 请求路由不存在').risk).toBe(false);
  });
});
