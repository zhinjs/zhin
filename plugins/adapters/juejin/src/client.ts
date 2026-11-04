/**
 * 掘金 Web API client（非官方接口，Experimental）。
 * 读：白名单文章的最新评论（`interact_api/v1/comment/list`）、登录账号（`user_api/v1/user/get`）；
 * 写：`replyComment`（`interact_api/v1/reply/publish`），只在人工审批草稿后由 endpoint 调用。
 * 永远不要记录 Cookie。
 */
import {
  JUEJIN_ARTICLE_ITEM_TYPE,
  JUEJIN_CLIENT_TYPE,
  JUEJIN_COMMENT_PAGE_SIZE,
  JUEJIN_LOGIN_REQUIRED_CODE,
  JUEJIN_NON_JSON_CODE,
  JUEJIN_RISK_HTTP_STATUSES,
  JUEJIN_RISK_MESSAGE,
  isJuejinId,
  type JuejinApiEnvelope,
  type JuejinCommentEntry,
  type JuejinUserInfo,
  type ResolvedJuejinConfig,
} from './protocol.js';

export type JuejinFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (zhin.js adapter-juejin; experimental)';
const WEB_ORIGIN = 'https://juejin.cn';

/**
 * 平台返回非 0 `err_no`、非 2xx 或非 JSON。`risk` 为 true 时调用方必须熔断；
 * `ambiguous` 为 true 表示写请求结果未知（可能已经发出），不能当成「没发」重试。
 */
export class JuejinApiError extends Error {
  readonly risk: boolean;
  readonly ambiguous: boolean;
  constructor(readonly code: number, message: string, options: { readonly httpStatus?: number; readonly ambiguous?: boolean } = {}) {
    super(message);
    this.name = 'JuejinApiError';
    this.httpStatus = options.httpStatus;
    this.ambiguous = options.ambiguous === true;
    this.risk = (options.httpStatus !== undefined && JUEJIN_RISK_HTTP_STATUSES.has(options.httpStatus))
      || code === JUEJIN_NON_JSON_CODE || JUEJIN_RISK_MESSAGE.test(message);
  }

  readonly httpStatus?: number;

  /** 平台判定未登录 / Cookie 失效。 */
  get loginRequired(): boolean {
    return this.code === JUEJIN_LOGIN_REQUIRED_CODE && this.httpStatus === undefined;
  }
}

export interface JuejinSelf {
  readonly userId: string;
  readonly userName?: string;
  readonly avatar?: string;
}

export interface JuejinCommentPage {
  readonly comments: readonly JuejinCommentEntry[];
  readonly count?: number;
  readonly hasMore?: boolean;
}

export interface JuejinReplyInput {
  readonly articleId: string;
  /** 评论楼根（一级评论 id）。 */
  readonly root: string;
  /** 直接回复的对象；等于 root 时回复一级评论，否则回复楼中楼里的那条回复。 */
  readonly parent: string;
  readonly message: string;
}

export class JuejinClient {
  #cookie?: string;
  readonly fetch: JuejinFetch;

  constructor(
    readonly config: ResolvedJuejinConfig,
    fetch: JuejinFetch,
    signal?: AbortSignal,
  ) {
    this.fetch = bindJuejinFetch(fetch, signal);
    this.#cookie = config.cookie;
  }

  get hasCookie(): boolean {
    return Boolean(this.#cookie);
  }

  /** 切换 Cookie（传 undefined 清空）。 */
  setCookie(cookie: string | undefined): void {
    this.#cookie = cookie || undefined;
  }

  #headers(json: boolean): Record<string, string> {
    return {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      Referer: `${WEB_ORIGIN}/`,
      Origin: WEB_ORIGIN,
      ...(this.#cookie ? { Cookie: this.#cookie } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  /**
   * 发请求并解出 `{ err_no, err_msg, data }` 信封。`write` 为 true 时，拿不到可解析的结果
   * （网络中断、超时、空响应、非 JSON）都按「结果未知」抛出 `ambiguous` 错误。
   */
  async request<T>(path: string, init: { readonly method?: 'GET' | 'POST'; readonly body?: unknown; readonly write?: boolean } = {}): Promise<JuejinApiEnvelope<T>> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.config.apiBaseUrl}${path}${separator}aid=${JUEJIN_CLIENT_TYPE}`;
    const write = init.write === true;
    let response;
    try {
      response = await this.fetch(url, {
        method: init.method ?? 'GET',
        headers: this.#headers(init.body !== undefined),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (!write) throw error;
      throw new JuejinApiError(-1, `Juejin request outcome unknown: ${error instanceof Error ? error.message : String(error)}`, { ambiguous: true });
    }
    if (!response.ok) {
      throw new JuejinApiError(-response.status, `Juejin HTTP ${response.status}`, { httpStatus: response.status });
    }
    const raw = await response.text().catch((error: unknown) => {
      if (write) throw new JuejinApiError(-1, 'Juejin response body was lost', { ambiguous: true });
      throw error;
    });
    if (!raw.trim()) {
      throw new JuejinApiError(-1, 'Juejin returned an empty response', { ambiguous: write });
    }
    let envelope: JuejinApiEnvelope<T>;
    try {
      envelope = JSON.parse(raw) as JuejinApiEnvelope<T>;
    } catch {
      // 非 JSON：多半被拦到验证页 / 登录页。写请求结果未知；同时当成风控熔断。
      throw new JuejinApiError(JUEJIN_NON_JSON_CODE, 'Juejin returned a non-JSON response (possible verification page)', { ambiguous: write });
    }
    if (typeof envelope?.err_no !== 'number') throw new JuejinApiError(-1, 'Malformed Juejin response', { ambiguous: write });
    if (envelope.err_no !== 0) {
      throw new JuejinApiError(envelope.err_no, `Juejin API ${envelope.err_no}: ${envelope.err_msg ?? ''}`.trim());
    }
    return envelope;
  }

  /** 登录态自检：当前账号（未登录 / Cookie 失效返回 undefined）。掘金未登录时返回 `data: null` 或 `err_no: 403`。 */
  async getSelf(): Promise<JuejinSelf | undefined> {
    if (!this.hasCookie) return undefined;
    let envelope: JuejinApiEnvelope<JuejinUserInfo | null>;
    try {
      envelope = await this.request<JuejinUserInfo | null>('/user_api/v1/user/get');
    } catch (error) {
      if (error instanceof JuejinApiError && error.loginRequired) return undefined;
      throw error;
    }
    const data = envelope.data;
    if (!data || !isJuejinId(data.user_id)) return undefined;
    return Object.freeze({
      userId: data.user_id,
      ...(typeof data.user_name === 'string' && data.user_name ? { userName: data.user_name } : {}),
      ...(typeof data.avatar_large === 'string' && data.avatar_large ? { avatar: data.avatar_large } : {}),
    });
  }

  /** 读取文章评论第一页（`sort=0` 最新在前），一级评论带内联的前几条回复。公开接口，不需要 Cookie。 */
  async listLatestComments(articleId: string, limit = JUEJIN_COMMENT_PAGE_SIZE): Promise<JuejinCommentPage> {
    const envelope = await this.request<readonly JuejinCommentEntry[] | null>('/interact_api/v1/comment/list', {
      method: 'POST',
      body: {
        item_id: articleId,
        item_type: JUEJIN_ARTICLE_ITEM_TYPE,
        cursor: '0',
        limit,
        sort: 0,
        client_type: JUEJIN_CLIENT_TYPE,
      },
    });
    return Object.freeze({
      comments: Object.freeze([...(Array.isArray(envelope.data) ? envelope.data : [])]),
      ...(typeof envelope.count === 'number' ? { count: envelope.count } : {}),
      ...(typeof envelope.has_more === 'boolean' ? { hasMore: envelope.has_more } : {}),
    });
  }

  /**
   * 回复评论（`POST interact_api/v1/reply/publish`）。只回复已有评论楼：`reply_to_comment_id` = 楼根，
   * 回复楼中楼时再带 `reply_to_reply_id`。字段取自社区实现（androidZzT/juejin-mcp `browser/comment.go`）；
   * 纯 HTTP 调用可能被掘金的反爬签名拒绝，见 docs/adapters/juejin.md「手动验证清单」。
   *
   * 只由 `JuejinEndpoint.approveDraft()` 在人工审批后调用；`send()` 永远不直接调用。
   * 返回新回复 id（平台没给时为 undefined，但 `err_no: 0` 仍视为已发出）。
   */
  async replyComment(input: JuejinReplyInput): Promise<string | undefined> {
    if (!this.#cookie) {
      throw new JuejinApiError(JUEJIN_LOGIN_REQUIRED_CODE, 'Juejin cookie is required to reply');
    }
    const envelope = await this.request<{ readonly reply_id?: unknown; readonly reply_info?: { readonly reply_id?: unknown } } | null>(
      '/interact_api/v1/reply/publish',
      {
        method: 'POST',
        write: true,
        body: {
          client_type: JUEJIN_CLIENT_TYPE,
          item_id: input.articleId,
          item_type: JUEJIN_ARTICLE_ITEM_TYPE,
          reply_content: input.message,
          reply_pics: [],
          reply_to_comment_id: input.root,
          ...(input.parent !== input.root ? { reply_to_reply_id: input.parent } : {}),
        },
      },
    );
    const id = envelope.data?.reply_id ?? envelope.data?.reply_info?.reply_id;
    return isJuejinId(id) ? id : undefined;
  }
}

export type JuejinClientEventMap = Record<string, unknown>;

/** Bind the actual account incarnation without changing existing request timeouts. */
function bindJuejinFetch(fetch: JuejinFetch, signal: AbortSignal | undefined): JuejinFetch {
  if (!signal) return fetch;
  return async (url, init) => {
    signal.throwIfAborted();
    const response = await fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    signal.throwIfAborted();
    return { ok: response.ok, status: response.status, async text() {
      const body = await response.text(); signal.throwIfAborted(); return body;
    } };
  };
}
