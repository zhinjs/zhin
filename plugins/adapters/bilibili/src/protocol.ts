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
    apiBaseUrl: (config.apiBaseUrl?.trim() || 'https://api.bilibili.com').replace(/\/+$/, ''),
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
