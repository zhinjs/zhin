import { vi } from 'vitest';
import type { JuejinFetch } from '../src/client.js';
import type { JuejinCommentEntry } from '../src/protocol.js';

export const ARTICLE = '7129482663794049032';
export const SELF_UID = '3000000000000001';

export function comment(id: string, extra: { user?: string; name?: string; ctime?: number; text?: string; isAuthor?: boolean; article?: string;
  replies?: Array<{ id: string; user?: string; name?: string; ctime?: number; text?: string; to?: string; isAuthor?: boolean }> } = {}): JuejinCommentEntry {
  const user = extra.user ?? '1000000000000001';
  return {
    comment_id: id,
    comment_info: { comment_id: id, user_id: user, item_id: extra.article ?? ARTICLE, item_type: 2,
      comment_content: extra.text ?? `comment ${id}`, ctime: extra.ctime ?? Number(id.slice(-6)), digg_count: 0, reply_count: extra.replies?.length ?? 0 },
    user_info: { user_id: user, user_name: extra.name ?? 'reader' },
    is_author: extra.isAuthor ?? false,
    reply_infos: (extra.replies ?? []).map(reply => ({
      reply_id: Number(reply.id),
      reply_info: { reply_id: reply.id, reply_comment_id: id, user_id: reply.user ?? '1000000000000002', reply_to_reply_id: reply.to ?? '0',
        reply_to_user_id: '0', item_id: extra.article ?? ARTICLE, item_type: 2, reply_content: reply.text ?? `reply ${reply.id}`,
        ctime: reply.ctime ?? Number(reply.id.slice(-6)), digg_count: 0 },
      user_info: { user_id: reply.user ?? '1000000000000002', user_name: reply.name ?? 'replier' },
      is_author: reply.isAuthor ?? false,
    })),
  };
}

export interface FakeOptions {
  /** 每次 comment/list 依次返回的页面（最后一页重复）；也可直接给原始 JSON 文本。 */
  readonly pages?: ReadonlyArray<readonly JuejinCommentEntry[] | string>;
  /** user/get 的 data；null = 未登录。 */
  readonly self?: { user_id: string; user_name?: string } | null;
  /** comment/list 第二次及以后返回的错误。 */
  readonly pollError?: { status?: number; errNo?: number; errMsg?: string; body?: string };
  /** reply/publish 的响应。 */
  readonly publish?: { status?: number; body?: string; throws?: boolean };
}

export function fakeFetch(options: FakeOptions = {}) {
  let pageCall = 0;
  const calls: string[] = [];
  const posts: Array<Record<string, unknown>> = [];
  const listBodies: Array<Record<string, unknown>> = [];
  const headers: Array<Record<string, string>> = [];
  let nextReply = 7400000000000000001n;
  const respond = (body: string, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
  const json = (value: unknown) => respond(JSON.stringify(value));
  const fetch: JuejinFetch = vi.fn(async (url: string, init) => {
    calls.push(url);
    headers.push({ ...(init?.headers ?? {}) });
    if (url.includes('/user_api/v1/user/get')) {
      return json({ err_no: 0, err_msg: 'success', data: options.self === undefined ? { user_id: SELF_UID, user_name: 'me' } : options.self });
    }
    if (url.includes('/interact_api/v1/comment/list')) {
      listBodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
      const error = options.pollError;
      if (error && pageCall > 0) {
        if (error.body !== undefined) return respond(error.body, error.status ?? 200);
        if (error.status) return respond('', error.status);
        return json({ err_no: error.errNo ?? 1, err_msg: error.errMsg ?? 'error', data: null });
      }
      const pages = options.pages ?? [[]];
      const page = pages[Math.min(pageCall, pages.length - 1)] ?? [];
      pageCall += 1;
      if (typeof page === 'string') return respond(page);
      return json({ err_no: 0, err_msg: 'success', data: page, cursor: String(page.length), count: page.length, has_more: false });
    }
    if (url.includes('/interact_api/v1/reply/publish')) {
      posts.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
      const publish = options.publish;
      if (publish?.throws) throw new Error('socket hang up');
      if (publish?.body !== undefined || publish?.status !== undefined) return respond(publish.body ?? '', publish.status ?? 200);
      nextReply += 1n;
      return respond(`{"err_no":0,"err_msg":"success","data":{"reply_id":"${nextReply}"}}`);
    }
    throw new Error(`unexpected ${url}`);
  });
  return { fetch, calls, posts, listBodies, headers };
}
