import type { EndpointProfileConfiguration } from 'zhin.js/adapter';
/**
 * 掘金（Juejin）评论协议辅助（Experimental，非官方 Web 接口）。
 *
 * 契约见 docs/adr/0035-comment-reply-adapter-contract.md（掘金是第二个实现）：
 * - 一条评论楼 = 一个 conversation：`article:<articleId>:<rootCommentId>`，parent = `article:<articleId>`
 * - 文章 id 是 19 位十进制字符串（`https://juejin.cn/post/<id>`），超过 2^53，**绝不能**转成 number。
 * - 读：`POST /interact_api/v1/comment/list`（`item_type=2` 文章，`sort=0` 最新在前），一级评论 + 每楼内联的前几条回复。
 * - 写：`POST /interact_api/v1/reply/publish`（只回复已有评论楼，带 `reply_to_comment_id`；回复楼中楼时再带 `reply_to_reply_id`）。
 */
import type { ConversationRef } from '@zhin.js/im-contract';

/** 文章评论区 item_type（`interact_api` 里 2 = 文章，4 = 沸点；本 adapter 只支持文章）。 */
export const JUEJIN_ARTICLE_ITEM_TYPE = 2;
/** 掘金 Web 端 client_type / aid。 */
export const JUEJIN_CLIENT_TYPE = 2608;
/** 回复长度上限（保守取值；超过直接拒绝，不截断）。 */
export const JUEJIN_COMMENT_MAX_LENGTH = 1000;
/** 默认轮询间隔下限（秒）。 */
export const JUEJIN_MIN_POLL_INTERVAL_SEC = 60;
/** 单次拉取的最新一级评论条数（接口上限 50；默认 20）。 */
export const JUEJIN_COMMENT_PAGE_SIZE = 20;

/** 未登录 / Cookie 失效：`{"err_no":403,"err_msg":"must login"}`。 */
export const JUEJIN_LOGIN_REQUIRED_CODE = 403;
/**
 * 被视为风控 / 频控信号的 HTTP 状态：立即熔断，不自动重试。
 * 403 / 429 = 网关拦截或限流（与 `err_no: 403` 未登录不同：那是 HTTP 200 + JSON）。
 */
export const JUEJIN_RISK_HTTP_STATUSES: ReadonlySet<number> = new Set([403, 429]);
/**
 * `err_msg` 命中这些关键字时视为风控（掘金没有公开的风控错误码表，只能按文案判断，宁可多熔断）：
 * 频繁 / 过快 / 太快 / 风控 / 验证码 / 人机 / 安全验证 / captcha / verify / too many / too frequent / rate limit。
 */
export const JUEJIN_RISK_MESSAGE = /频繁|过快|太快|风控|验证码|人机|安全验证|captcha|verify|too many|too frequent|rate limit/iu;
/** 响应不是 JSON（例如被重定向到验证页）时使用的伪错误码。 */
export const JUEJIN_NON_JSON_CODE = -2;

export type JuejinSendMode = 'review' | 'off';

/** 审批后两次真实发送之间的默认最小间隔（秒）与下限。 */
export const JUEJIN_DEFAULT_SEND_INTERVAL_SEC = 30;
export const JUEJIN_MIN_SEND_INTERVAL_SEC = 10;

/** One endpoint config after AdapterIndex expands `<instanceKey>.endpoints`. */
export interface JuejinEndpointConfig extends EndpointProfileConfiguration {
  readonly id: string;
  /** @internal Assigned only for fresh Adapter identities; imported records retain their original data path. */
  readonly stateDirectoryId?: string;
  /** 掘金网页登录态 Cookie 整串（至少含 `sessionid`）。请用 `${JUEJIN_COOKIE}` 注入，切勿写进仓库。 */
  readonly cookie?: string;
  /** 白名单文章：文章 id（字符串）或 `https://juejin.cn/post/<id>` 链接。只轮询这些文章。 */
  readonly articles?: readonly (string | number)[];
  /** 轮询间隔秒数，最小 60。 */
  readonly pollIntervalSec?: number;
  /** 出站模式：`review`（默认，进草稿队列）/ `off`（禁止出站）。 */
  readonly sendMode?: JuejinSendMode;
  /** 审批后两次真实发送的最小间隔秒数（默认 30，最小 10）。 */
  readonly minSendIntervalSec?: number;
  /** 草稿的本地目录（默认 `data/juejin`，相对进程工作目录）。不要放进仓库。 */
  readonly dataDir?: string;
  /** 新草稿 / 登录失效时主动提醒到哪个聊天会话（可选）。 */
  readonly notify?: JuejinNotifyTarget;
  readonly apiBaseUrl?: string;
}

/** 主动提醒目标：另一个已接入聊天平台里的会话（通常是你和机器人的私聊）。 */
export interface JuejinNotifyTarget {
  readonly adapter: string;
  readonly endpoint: string;
  readonly kind?: 'private' | 'group' | 'channel';
  readonly id: string | number;
}

export interface ResolvedJuejinNotifyTarget {
  readonly adapter: string;
  readonly endpoint: string;
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
}

export interface ResolvedJuejinConfig {
  readonly context: 'juejin';
  readonly id: string;
  readonly stateDirectoryId?: string;
  readonly cookie?: string;
  /** 白名单文章 id（十进制字符串，去重后保持配置顺序）。 */
  readonly articles: readonly string[];
  readonly pollIntervalMs: number;
  readonly sendMode: JuejinSendMode;
  readonly minSendIntervalMs: number;
  readonly dataDir: string;
  readonly notify?: ResolvedJuejinNotifyTarget;
  readonly apiBaseUrl: string;
}

export const JUEJIN_DEFAULT_DATA_DIR = 'data/juejin';
export const JUEJIN_DEFAULT_API_BASE_URL = 'https://api.juejin.cn';

const ID = /^[1-9]\d{0,19}$/u;

/** 掘金 id（文章 / 评论 / 回复 / 用户）都是十进制字符串；`'0'` 表示「没有」。 */
export function isJuejinId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

/**
 * 白名单文章：`7129482663794049032` 或 `https://juejin.cn/post/7129482663794049032`（可带 query / hash）。
 * YAML 里不加引号的 19 位数字会丢精度，直接拒绝，避免回复到错误的文章。
 */
export function parseArticleRef(value: string | number): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError(`Juejin article id ${String(value)} lost precision; quote it as a string in the config`);
  }
  const raw = String(value).trim();
  if (ID.test(raw)) return raw;
  const url = /^https?:\/\/(?:www\.)?juejin\.cn\/post\/([1-9]\d{0,19})(?:[/?#].*)?$/iu.exec(raw);
  if (url) return url[1]!;
  throw new TypeError(`Juejin article must be an article id or https://juejin.cn/post/<id> link, got "${raw}"`);
}

function resolveNotifyTarget(value: JuejinNotifyTarget | undefined): ResolvedJuejinNotifyTarget | undefined {
  if (value === undefined || value === null) return undefined;
  const adapter = typeof value.adapter === 'string' ? value.adapter.trim() : '';
  const endpoint = typeof value.endpoint === 'string' ? value.endpoint.trim() : String(value.endpoint ?? '').trim();
  const id = String(value.id ?? '').trim();
  const kind = value.kind ?? 'private';
  if (!adapter || !endpoint || !id) throw new TypeError('Juejin notify requires adapter, endpoint and id');
  if (kind !== 'private' && kind !== 'group' && kind !== 'channel') {
    throw new TypeError(`Juejin notify.kind must be private, group or channel, got "${String(kind)}"`);
  }
  return Object.freeze({ adapter, endpoint, kind, id });
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return value.slice(0, end);
}

/** Cookie 只允许单行；换行会被当成 header 注入。 */
function resolveCookie(value: string | undefined): string | undefined {
  const cookie = typeof value === 'string' ? value.trim() : '';
  if (!cookie) return undefined;
  if (/[\r\n]/u.test(cookie)) throw new TypeError('Juejin cookie must be a single line');
  return cookie;
}

export function resolveJuejinConfig(config: JuejinEndpointConfig): ResolvedJuejinConfig {
  const id = typeof config.id === 'string' ? config.id.trim() : '';
  if (!id) throw new TypeError('Juejin endpoint requires a non-empty id');
  const sendMode = config.sendMode ?? 'review';
  if (sendMode !== 'review' && sendMode !== 'off') {
    // auto 直发刻意不开放（ADR 0035 §3）。
    throw new TypeError(`Juejin sendMode must be "review" or "off", got "${String(sendMode)}"`);
  }
  const interval = Math.max(
    JUEJIN_MIN_POLL_INTERVAL_SEC,
    Number.isFinite(config.pollIntervalSec) ? Number(config.pollIntervalSec) : JUEJIN_MIN_POLL_INTERVAL_SEC,
  );
  const sendInterval = Math.max(
    JUEJIN_MIN_SEND_INTERVAL_SEC,
    Number.isFinite(config.minSendIntervalSec) ? Number(config.minSendIntervalSec) : JUEJIN_DEFAULT_SEND_INTERVAL_SEC,
  );
  const cookie = resolveCookie(config.cookie);
  const notify = resolveNotifyTarget(config.notify);
  return {
    context: 'juejin',
    id,
    ...(config.stateDirectoryId ? { stateDirectoryId: config.stateDirectoryId } : {}),
    ...(cookie ? { cookie } : {}),
    articles: Object.freeze([...new Set((config.articles ?? []).map(parseArticleRef))]),
    pollIntervalMs: interval * 1000,
    sendMode,
    minSendIntervalMs: sendInterval * 1000,
    dataDir: config.dataDir?.trim() || JUEJIN_DEFAULT_DATA_DIR,
    ...(notify ? { notify } : {}),
    apiBaseUrl: trimTrailingSlashes(config.apiBaseUrl?.trim() || JUEJIN_DEFAULT_API_BASE_URL),
  };
}

// ── Wire shapes (fields we consume) ───────────────────────────────────────────

export interface JuejinApiEnvelope<T> {
  readonly err_no: number;
  readonly err_msg?: string;
  readonly data?: T;
  readonly cursor?: string;
  readonly count?: number;
  readonly has_more?: boolean;
}

export interface JuejinUserInfo {
  readonly user_id?: string;
  readonly user_name?: string;
  readonly avatar_large?: string;
}

/** `comment/list` 的一条楼中楼回复（`reply_infos[i]`）。注意顶层 `reply_id` 是会丢精度的 JSON number，只用 `reply_info.reply_id`。 */
export interface JuejinReplyEntry {
  readonly reply_id?: unknown;
  readonly reply_info?: {
    readonly reply_id?: string;
    /** 所在评论楼（一级评论 id）。 */
    readonly reply_comment_id?: string;
    readonly user_id?: string;
    /** 回复的是哪条楼中楼回复；`'0'` = 直接回复一级评论。 */
    readonly reply_to_reply_id?: string;
    readonly reply_to_user_id?: string;
    readonly item_id?: string;
    readonly item_type?: number;
    readonly reply_content?: string;
    readonly ctime?: number;
    readonly digg_count?: number;
  };
  readonly user_info?: JuejinUserInfo;
  /** 回复者是否文章作者。 */
  readonly is_author?: boolean;
}

/** `comment/list` 的一条一级评论。 */
export interface JuejinCommentEntry {
  readonly comment_id?: string;
  readonly comment_info?: {
    readonly comment_id?: string;
    readonly user_id?: string;
    readonly item_id?: string;
    readonly item_type?: number;
    readonly comment_content?: string;
    readonly ctime?: number;
    readonly digg_count?: number;
    readonly reply_count?: number;
  };
  readonly user_info?: JuejinUserInfo;
  /** 评论者是否文章作者。 */
  readonly is_author?: boolean;
  /** 内联预览：每楼最早的几条回复（实测 2 条），不是全量。 */
  readonly reply_infos?: readonly JuejinReplyEntry[] | null;
}

/** 归一化后的评论（一级评论或楼中楼回复）。 */
export interface JuejinComment {
  readonly kind: 'comment' | 'reply';
  /** 评论 id（一级）或回复 id（楼中楼）。 */
  readonly id: string;
  readonly articleId: string;
  /** 所在评论楼的根（一级评论 id）。 */
  readonly rootId: string;
  /** 直接回复的对象：楼中楼回复的 `reply_to_reply_id`，否则为根。 */
  readonly parentId: string;
  readonly userId: string;
  readonly userName?: string;
  readonly text: string;
  /** 秒级时间戳。 */
  readonly ctime: number;
  readonly diggCount: number;
  /** 平台标记的「作者」评论（白名单是自己的文章，所以作者 = 自己）。 */
  readonly isAuthor: boolean;
}

/**
 * 把一页 `comment/list` 摊平成评论 + 内联回复。缺 id、id 不是十进制字符串、不属于这篇文章的条目一律丢弃
 * （宁可漏，也不回错楼）。
 */
export function flattenComments(articleId: string, entries: readonly JuejinCommentEntry[] | null | undefined): JuejinComment[] {
  const out: JuejinComment[] = [];
  for (const entry of entries ?? []) {
    const info = entry?.comment_info;
    const id = info?.comment_id ?? entry?.comment_id;
    const userId = info?.user_id ?? entry?.user_info?.user_id;
    if (!isJuejinId(id) || !isJuejinId(userId) || info?.item_id !== articleId) continue;
    out.push(Object.freeze({
      kind: 'comment' as const, id, articleId, rootId: id, parentId: id, userId,
      ...(entry.user_info?.user_name ? { userName: entry.user_info.user_name } : {}),
      text: info.comment_content ?? '', ctime: Number(info.ctime) || 0, diggCount: Number(info.digg_count) || 0,
      isAuthor: entry.is_author === true,
    }));
    for (const child of entry.reply_infos ?? []) {
      const reply = child?.reply_info;
      if (!reply || !isJuejinId(reply.reply_id) || reply.reply_comment_id !== id || !isJuejinId(reply.user_id)) continue;
      if (reply.item_id !== undefined && reply.item_id !== articleId) continue;
      const target = reply.reply_to_reply_id;
      out.push(Object.freeze({
        kind: 'reply' as const, id: reply.reply_id, articleId, rootId: id,
        parentId: isJuejinId(target) ? target : id, userId: reply.user_id,
        ...(child.user_info?.user_name ? { userName: child.user_info.user_name } : {}),
        text: reply.reply_content ?? '', ctime: Number(reply.ctime) || 0, diggCount: Number(reply.digg_count) || 0,
        isAuthor: child.is_author === true,
      }));
    }
  }
  return out;
}

// ── Conversation ids ─────────────────────────────────────────────────────────

/** 评论区资源会话 id（评论楼的 parent）：`article:<articleId>`。 */
export function articleResourceId(articleId: string): string {
  return `article:${articleId}`;
}

/** 评论楼会话 id：`article:<articleId>:<rootCommentId>`。 */
export function threadConversationId(articleId: string, rootCommentId: string): string {
  return `${articleResourceId(articleId)}:${rootCommentId}`;
}

export interface ParsedThreadId {
  readonly articleId: string;
  readonly root: string;
}

export function parseThreadConversationId(id: string): ParsedThreadId | undefined {
  const match = /^article:([1-9]\d{0,19}):([1-9]\d{0,19})$/u.exec(id);
  if (!match) return undefined;
  return { articleId: match[1]!, root: match[2]! };
}

export function juejinThreadConversation(endpointKey: string, articleId: string, rootCommentId: string): ConversationRef {
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind: 'channel',
    id: threadConversationId(articleId, rootCommentId),
    parent: { kind: 'channel', id: articleResourceId(articleId) },
  };
}

/** 文章页链接（掘金没有可靠的单条评论锚点，审批时到文章评论区对照）。 */
export function articleUrl(articleId: string): string {
  return `https://juejin.cn/post/${articleId}`;
}

// ── Outbound ─────────────────────────────────────────────────────────────────

interface WireSegment {
  readonly type?: string;
  readonly data?: Record<string, unknown>;
}

/** 出站 payload 里 `reply` 段指向的评论 / 回复 id（十进制字符串才认）。 */
export function outboundReplyTarget(payload: unknown): string | undefined {
  const items = Array.isArray(payload) ? payload : [payload];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as WireSegment;
    if (seg.type !== 'reply') continue;
    const id = String(seg.data?.id ?? seg.data?.message_id ?? '').trim();
    if (isJuejinId(id)) return id;
  }
  return undefined;
}

/** 出站：评论只支持纯文本；mention 降级为 `@昵称`。 */
export function formatOutboundText(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (payload == null) return '';
  const items = Array.isArray(payload) ? payload : [payload];
  return items.map((item) => {
    if (typeof item === 'string') return item;
    const seg = item as WireSegment;
    switch (seg.type) {
      case 'text':
        return String(seg.data?.text ?? '');
      case 'mention':
      case 'at':
        return `@${String(seg.data?.name ?? seg.data?.id ?? '')} `;
      default:
        return '';
    }
  }).join('').trim();
}

/** 审批前校验回复正文；合法返回 undefined。 */
export function validateReplyText(message: string): string | undefined {
  if (!message) return 'Empty Juejin reply';
  if ([...message].length > JUEJIN_COMMENT_MAX_LENGTH) return `Juejin reply exceeds ${JUEJIN_COMMENT_MAX_LENGTH} characters`;
  return undefined;
}
