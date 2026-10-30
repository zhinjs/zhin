/**
 * Bilibili Web API client（非官方接口，Experimental）。
 * 读：白名单视频评论、「回复我的 / @我的」通知；写：`addReply`，只在人工审批草稿后由 endpoint 调用。
 * 永远不要记录 Cookie。
 */
import {
  BILIBILI_RISK_CODES,
  BILIBILI_VIDEO_COMMENT_TYPE,
  type BilibiliApiEnvelope,
  type BilibiliNotificationKind,
  type BilibiliNotificationPage,
  type BilibiliReply,
  type BilibiliReplyPage,
  type ResolvedBilibiliConfig,
} from './protocol.js';

export type BilibiliFetch = (
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
  json(): Promise<unknown>;
}>;

const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (zhin.js adapter-bilibili; experimental)';

/** 平台返回非 0 code。`risk` 为 true 时调用方必须熔断。 */
export class BilibiliApiError extends Error {
  readonly risk: boolean;
  constructor(readonly code: number, message: string, readonly httpStatus?: number) {
    super(message);
    this.name = 'BilibiliApiError';
    this.risk = BILIBILI_RISK_CODES.has(code) || httpStatus === 412;
  }
}

/** 当前生效的 Cookie（来自配置 / 环境变量，或扫码登录后的本地凭据）。 */
export interface BilibiliCookie {
  readonly sessdata?: string;
  readonly biliJct?: string;
}

export interface BilibiliNav {
  readonly mid: string;
  readonly uname?: string;
}

export class BilibiliClient {
  #cookie: BilibiliCookie;
  readonly fetch: BilibiliFetch;

  constructor(
    readonly config: ResolvedBilibiliConfig,
    fetch: BilibiliFetch,
    signal?: AbortSignal,
  ) {
    this.fetch = bindBilibiliFetch(fetch, signal);
    this.#cookie = Object.freeze({
      ...(config.sessdata ? { sessdata: config.sessdata } : {}),
      ...(config.biliJct ? { biliJct: config.biliJct } : {}),
    });
  }

  get hasCookie(): boolean {
    return Boolean(this.#cookie.sessdata);
  }

  /** 是否具备发送所需的 SESSDATA + bili_jct。 */
  get canWrite(): boolean {
    return Boolean(this.#cookie.sessdata && this.#cookie.biliJct);
  }

  /** 切换 Cookie（扫码登录 / 退出 / 失效清除）。传 undefined 清空。 */
  setCookie(cookie: BilibiliCookie | undefined): void {
    this.#cookie = Object.freeze({
      ...(cookie?.sessdata ? { sessdata: cookie.sessdata } : {}),
      ...(cookie?.biliJct ? { biliJct: cookie.biliJct } : {}),
    });
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    const { sessdata, biliJct } = this.#cookie;
    const cookie = [
      sessdata ? `SESSDATA=${sessdata}` : '',
      biliJct ? `bili_jct=${biliJct}` : '',
    ].filter(Boolean).join('; ');
    return {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.bilibili.com/',
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    };
  }

  async request<T>(path: string, init: { readonly method?: string; readonly body?: string } = {}): Promise<T> {
    const response = await this.fetch(`${this.config.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: this.#headers(init.body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new BilibiliApiError(-response.status, `Bilibili HTTP ${response.status}`, response.status);
    }
    const envelope = await response.json() as BilibiliApiEnvelope<T>;
    if (typeof envelope?.code !== 'number') throw new BilibiliApiError(-1, 'Malformed Bilibili response');
    if (envelope.code !== 0) {
      throw new BilibiliApiError(envelope.code, `Bilibili API ${envelope.code}: ${envelope.message ?? ''}`.trim());
    }
    return envelope.data as T;
  }

  /** 登录态自检：返回当前账号 uid（未登录返回 undefined）。 */
  async getSelfMid(): Promise<string | undefined> {
    return (await this.getNav())?.mid;
  }

  /** 登录态自检：uid + 昵称（未登录返回 undefined）。未登录时 B 站返回 -101。 */
  async getNav(): Promise<BilibiliNav | undefined> {
    if (!this.hasCookie) return undefined;
    let data: { isLogin?: boolean; mid?: number; uname?: string } | undefined;
    try {
      data = await this.request<{ isLogin?: boolean; mid?: number; uname?: string }>('/x/web-interface/nav');
    } catch (error) {
      if (error instanceof BilibiliApiError && error.code === -101) return undefined;
      throw error;
    }
    return data?.isLogin && data.mid
      ? Object.freeze({ mid: String(data.mid), ...(data.uname ? { uname: data.uname } : {}) })
      : undefined;
  }

  /** BV → aid（公开接口）。 */
  async resolveAid(bvid: string): Promise<string> {
    const data = await this.request<{ aid?: number }>(`/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
    if (!data?.aid) throw new BilibiliApiError(-404, `Cannot resolve aid for ${bvid}`);
    return String(data.aid);
  }

  /** 读取视频评论第一页（按时间倒序）。 */
  listLatestVideoReplies(aid: string, pageSize = 20): Promise<BilibiliReplyPage> {
    const query = new URLSearchParams({
      type: String(BILIBILI_VIDEO_COMMENT_TYPE),
      oid: aid,
      sort: '0',
      pn: '1',
      ps: String(pageSize),
    });
    return this.request<BilibiliReplyPage>(`/x/v2/reply?${query.toString()}`);
  }

  /** 「回复我的」（`x/msgfeed/reply`）/「@我的」（`x/msgfeed/at`）最新一页通知。需要 Cookie。 */
  listNotifications(kind: BilibiliNotificationKind): Promise<BilibiliNotificationPage> {
    if (!this.hasCookie) {
      return Promise.reject(new BilibiliApiError(-101, 'Bilibili cookie (SESSDATA) is required to read notifications'));
    }
    const query = new URLSearchParams({ platform: 'web', build: '0', mobi_app: 'web' });
    return this.request<BilibiliNotificationPage>(`/x/msgfeed/${kind}?${query.toString()}`);
  }

  /**
   * 回复评论（`POST x/v2/reply/add`）。
   * 只由 `BilibiliEndpoint.approveDraft()` 在人工审批后调用；`send()` 永远不直接调用。
   */
  async addReply(input: { readonly oid: string; readonly root: string; readonly parent: string; readonly message: string }): Promise<string> {
    const csrf = this.#cookie.biliJct;
    if (!this.#cookie.sessdata || !csrf) {
      throw new BilibiliApiError(-101, 'Bilibili cookie (SESSDATA + bili_jct) is required to reply');
    }
    const body = new URLSearchParams({
      type: String(BILIBILI_VIDEO_COMMENT_TYPE),
      oid: input.oid,
      root: input.root,
      parent: input.parent,
      message: input.message,
      csrf,
    });
    const data = await this.request<{ rpid?: number; rpid_str?: string }>('/x/v2/reply/add', {
      method: 'POST',
      body: body.toString(),
    });
    const rpid = data?.rpid_str ?? (data?.rpid ? String(data.rpid) : '');
    if (!rpid) throw new BilibiliApiError(-1, 'Bilibili did not return a reply id');
    return rpid;
  }
}

export type BilibiliClientEventMap = Record<string, BilibiliReply>;

/** Bind the actual account incarnation without changing existing request timeouts. */
function bindBilibiliFetch(fetch: BilibiliFetch, signal: AbortSignal | undefined): BilibiliFetch {
  if (!signal) return fetch;
  return async (url, init) => {
    signal.throwIfAborted();
    const response = await fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    signal.throwIfAborted();
    return { ok: response.ok, status: response.status, async json() {
      const body = await response.json(); signal.throwIfAborted(); return body;
    } };
  };
}
