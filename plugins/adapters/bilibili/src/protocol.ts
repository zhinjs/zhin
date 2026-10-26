/**
 * Bilibili 评论协议辅助（Experimental，非官方 Web 接口）。
 *
 * 契约见 docs/adr/0035-comment-reply-adapter-contract.md：
 * - 一条评论楼 = 一个 conversation：`video:<aid>:<rootRpid>`，parent = `video:<aid>`
 * - 只做视频评论（type=1）
 */
import type { ConversationRef } from '@zhin.js/im-contract';

/** 视频评论区 type（x/v2/reply?type=1）。 */
export const BILIBILI_VIDEO_COMMENT_TYPE = 1;
/** B 站评论长度上限。 */
export const BILIBILI_COMMENT_MAX_LENGTH = 1000;
/** 默认轮询间隔下限（秒）。 */
export const BILIBILI_MIN_POLL_INTERVAL_SEC = 60;

/**
 * 平台风控 / 频控类错误码：视为熔断信号，不自动重试。
 * -352 / -412 风控拦截，-509 请求过于频繁，12015 需要验证码，12051 重复评论。
 */
export const BILIBILI_RISK_CODES: ReadonlySet<number> = new Set([-352, -412, -509, 12015, 12051]);

export type BilibiliSendMode = 'review' | 'off';

/** 审批后两次真实发送之间的默认最小间隔（秒）与下限。 */
export const BILIBILI_DEFAULT_SEND_INTERVAL_SEC = 30;
export const BILIBILI_MIN_SEND_INTERVAL_SEC = 10;

/** 「回复我的 / @我的」通知源。 */
export type BilibiliNotificationKind = 'reply' | 'at';
/** 通知入站范围：`whitelist` 只收白名单视频下的通知（默认）；`all` 收所有视频评论通知。 */
export type BilibiliNotificationScope = 'whitelist' | 'all';

/** One endpoint config after AdapterIndex expands `<instanceKey>.endpoints`. */
export interface BilibiliEndpointConfig {
  readonly id: string;
  /** Cookie SESSDATA（请用 ${ENV} 注入，切勿写进仓库）。 */
  readonly sessdata?: string;
  /** Cookie bili_jct（即 csrf token）。 */
  readonly biliJct?: string;
  /** 白名单视频：BV 号或 av 号（`BV1xx...` / `av123` / `123`）。 */
  readonly videos?: readonly (string | number)[];
  /** 轮询间隔秒数，最小 60。 */
  readonly pollIntervalSec?: number;
  /** 出站模式：`review`（默认，进草稿队列）/ `off`（禁止出站）。 */
  readonly sendMode?: BilibiliSendMode;
  /** 审批后两次真实发送的最小间隔秒数（默认 30，最小 10）。 */
  readonly minSendIntervalSec?: number;
  /** 额外轮询的通知源：`reply`（回复我的）/ `at`（@我的）。默认不开；需要 Cookie。 */
  readonly notifications?: readonly BilibiliNotificationKind[];
  /** 通知入站范围，默认 `whitelist`。 */
  readonly notificationScope?: BilibiliNotificationScope;
  readonly apiBaseUrl?: string;
}

export interface ResolvedBilibiliConfig {
  readonly context: 'bilibili';
  readonly id: string;
  readonly sessdata?: string;
  readonly biliJct?: string;
  readonly videos: readonly BilibiliVideoRef[];
  readonly pollIntervalMs: number;
  readonly sendMode: BilibiliSendMode;
  readonly minSendIntervalMs: number;
  readonly notifications: readonly BilibiliNotificationKind[];
  readonly notificationScope: BilibiliNotificationScope;
  readonly apiBaseUrl: string;
}

export type BilibiliVideoRef =
  | { readonly kind: 'bvid'; readonly bvid: string }
  | { readonly kind: 'aid'; readonly aid: string };

export function parseVideoRef(value: string | number): BilibiliVideoRef {
  const raw = String(value).trim();
  if (/^BV[0-9A-Za-z]{10}$/.test(raw)) return { kind: 'bvid', bvid: raw };
  const av = /^(?:av)?(\d+)$/i.exec(raw);
  if (av) return { kind: 'aid', aid: av[1]! };
  throw new TypeError(`Bilibili video must be a BV id or av number, got "${raw}"`);
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return value.slice(0, end);
}

export function resolveBilibiliConfig(config: BilibiliEndpointConfig): ResolvedBilibiliConfig {
  const id = typeof config.id === 'string' ? config.id.trim() : '';
  if (!id) throw new TypeError('Bilibili endpoint requires a non-empty id');
  const sendMode = config.sendMode ?? 'review';
  if (sendMode !== 'review' && sendMode !== 'off') {
    // auto 直发在 v1 中刻意不开放（ADR 0035 §3）。
    throw new TypeError(`Bilibili sendMode must be "review" or "off", got "${String(sendMode)}"`);
  }
  const interval = Math.max(
    BILIBILI_MIN_POLL_INTERVAL_SEC,
    Number.isFinite(config.pollIntervalSec) ? Number(config.pollIntervalSec) : BILIBILI_MIN_POLL_INTERVAL_SEC,
  );
  const sendInterval = Math.max(
    BILIBILI_MIN_SEND_INTERVAL_SEC,
    Number.isFinite(config.minSendIntervalSec) ? Number(config.minSendIntervalSec) : BILIBILI_DEFAULT_SEND_INTERVAL_SEC,
  );
  const notifications = [...new Set(config.notifications ?? [])];
  for (const kind of notifications) {
    if (kind !== 'reply' && kind !== 'at') {
      throw new TypeError(`Bilibili notifications must be "reply" or "at", got "${String(kind)}"`);
    }
  }
  const notificationScope = config.notificationScope ?? 'whitelist';
  if (notificationScope !== 'whitelist' && notificationScope !== 'all') {
    throw new TypeError(`Bilibili notificationScope must be "whitelist" or "all", got "${String(notificationScope)}"`);
  }
  const sessdata = config.sessdata?.trim() || undefined;
  const biliJct = config.biliJct?.trim() || undefined;
  return {
    context: 'bilibili',
    id,
    ...(sessdata ? { sessdata } : {}),
    ...(biliJct ? { biliJct } : {}),
    videos: (config.videos ?? []).map(parseVideoRef),
    pollIntervalMs: interval * 1000,
    sendMode,
    minSendIntervalMs: sendInterval * 1000,
    notifications: Object.freeze(notifications),
    notificationScope,
    apiBaseUrl: trimTrailingSlashes(config.apiBaseUrl?.trim() || 'https://api.bilibili.com'),
  };
}

/** Wire shape of one reply in `x/v2/reply` (fields we consume). */
export interface BilibiliReply {
  readonly rpid: number;
  readonly oid: number;
  readonly type: number;
  readonly mid: number;
  /** 0 = 一级评论；否则为所在楼的根评论 rpid。 */
  readonly root: number;
  /** 0 = 一级评论；否则为直接回复的评论 rpid。 */
  readonly parent: number;
  readonly ctime: number;
  readonly like?: number;
  readonly member?: { readonly mid?: string; readonly uname?: string };
  readonly content?: { readonly message?: string };
  readonly up_action?: unknown;
  readonly replies?: readonly BilibiliReply[] | null;
}

export interface BilibiliApiEnvelope<T> {
  readonly code: number;
  readonly message?: string;
  readonly data?: T;
}

export interface BilibiliReplyPage {
  readonly replies?: readonly BilibiliReply[] | null;
  readonly upper?: { readonly mid?: number };
}

/** 评论楼根 rpid：一级评论自身即根。 */
export function threadRootOf(reply: Pick<BilibiliReply, 'rpid' | 'root'>): string {
  return String(reply.root && reply.root !== 0 ? reply.root : reply.rpid);
}

export function videoResourceId(aid: string | number): string {
  return `video:${aid}`;
}

export function threadConversationId(aid: string | number, rootRpid: string | number): string {
  return `${videoResourceId(aid)}:${rootRpid}`;
}

export interface ParsedThreadId {
  readonly type: 'video';
  readonly oid: string;
  readonly root: string;
}

export function parseThreadConversationId(id: string): ParsedThreadId | undefined {
  const match = /^video:(\d+):(\d+)$/.exec(id);
  if (!match) return undefined;
  return { type: 'video', oid: match[1]!, root: match[2]! };
}

export function bilibiliThreadConversation(
  endpointKey: string,
  aid: string | number,
  rootRpid: string | number,
): ConversationRef {
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind: 'channel',
    id: threadConversationId(aid, rootRpid),
    parent: { kind: 'channel', id: videoResourceId(aid) },
  };
}

/** Flatten a page: top-level replies plus their inline preview sub-replies. */
export function flattenReplies(replies: readonly BilibiliReply[] | null | undefined): BilibiliReply[] {
  const out: BilibiliReply[] = [];
  for (const reply of replies ?? []) {
    out.push(reply);
    for (const child of reply.replies ?? []) out.push(child);
  }
  return out;
}

/** One item of `x/msgfeed/reply` / `x/msgfeed/at` (fields we consume). */
export interface BilibiliNotificationItem {
  readonly id: number;
  readonly user?: { readonly mid?: number; readonly nickname?: string };
  readonly item?: {
    readonly type?: string;
    /** 1 = 视频评论；其余（动态 11/17 等）v1 忽略。 */
    readonly business_id?: number;
    /** 评论区 oid（视频即 aid）。 */
    readonly subject_id?: number;
    /** 根评论 rpid；0 表示通知里的评论本身是一级评论。 */
    readonly root_id?: number;
    /** 触发通知的这条评论 rpid。 */
    readonly source_id?: number;
    /** 被回复的评论 rpid（@ 通知里通常为 0）。 */
    readonly target_id?: number;
    readonly source_content?: string;
  };
  readonly reply_time?: number;
  readonly at_time?: number;
}

export interface BilibiliNotificationPage {
  readonly items?: readonly BilibiliNotificationItem[] | null;
  readonly cursor?: { readonly is_end?: boolean; readonly id?: number; readonly time?: number };
}

/**
 * 把一条视频评论通知还原成评论结构；非视频评论 / 缺字段时返回 undefined。
 */
export function notificationToReply(entry: BilibiliNotificationItem): BilibiliReply | undefined {
  const item = entry.item;
  if (!item || item.business_id !== BILIBILI_VIDEO_COMMENT_TYPE) return undefined;
  if (item.type !== undefined && item.type !== 'reply') return undefined;
  const rpid = Number(item.source_id);
  const oid = Number(item.subject_id);
  const mid = Number(entry.user?.mid);
  if (!rpid || !oid || !mid) return undefined;
  const root = Number(item.root_id) || 0;
  return {
    rpid,
    oid,
    type: BILIBILI_VIDEO_COMMENT_TYPE,
    mid,
    root,
    parent: Number(item.target_id) || root,
    ctime: Number(entry.reply_time ?? entry.at_time ?? 0),
    member: { mid: String(mid), ...(entry.user?.nickname ? { uname: entry.user.nickname } : {}) },
    content: { message: item.source_content ?? '' },
  };
}

/** 出站 payload 里 `reply` 段指向的评论 rpid（纯数字才认）。 */
export function outboundReplyTarget(payload: unknown): string | undefined {
  const items = Array.isArray(payload) ? payload : [payload];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as WireSegment;
    if (seg.type !== 'reply') continue;
    const id = String(seg.data?.id ?? seg.data?.message_id ?? '').trim();
    if (/^\d+$/.test(id)) return id;
  }
  return undefined;
}

interface WireSegment {
  readonly type?: string;
  readonly data?: Record<string, unknown>;
}

/** 出站：评论只支持纯文本；mention 降级为 `@昵称`。 */
export function formatOutboundText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
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
