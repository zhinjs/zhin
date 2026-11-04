import type { EndpointProfileConfiguration } from 'zhin.js/adapter';
/**
 * Bilibili 评论协议辅助（Experimental，非官方 Web 接口）。
 *
 * 契约见 docs/adr/0035-comment-reply-adapter-contract.md：
 * - 一条评论楼 = 一个 conversation：`<resource>:<oid>:<rootRpid>`，parent = `<resource>:<oid>`
 * - 评论区（`x/v2/reply?type=&oid=`）：视频 `video`（type=1，oid=aid）、图文动态 `album`（type=11，oid=相簿 id）、
 *   专栏 `article`（type=12，oid=cvid）、纯文字 / 转发动态 `dynamic`（type=17，oid=动态 id）。
 * - 动态 id 不能直接当评论区 oid：必须先用动态详情（`x/polymer/web-dynamic/v1/detail`）的
 *   `basic.comment_type` / `basic.comment_id_str` 解析出 (type, oid)，见 {@link resolveDynamicCommentArea}。
 */
import type { ConversationRef } from '@zhin.js/im-contract';

/** 视频评论区 type（x/v2/reply?type=1）。 */
export const BILIBILI_VIDEO_COMMENT_TYPE = 1;
/** 图文（带图）动态评论区 type：oid 是相簿 id（不是动态 id）。 */
export const BILIBILI_ALBUM_COMMENT_TYPE = 11;
/** 专栏评论区 type：oid 是 cvid。 */
export const BILIBILI_ARTICLE_COMMENT_TYPE = 12;
/** 纯文字 / 转发动态评论区 type：oid 是动态 id 本身。 */
export const BILIBILI_DYNAMIC_COMMENT_TYPE = 17;

/** 评论区资源种类 = conversation id 前缀；每个前缀只对应一种评论区 type，不靠运行时查表。 */
export type BilibiliResourceKind = 'video' | 'album' | 'article' | 'dynamic';

const COMMENT_TYPE_OF: Readonly<Record<BilibiliResourceKind, number>> = Object.freeze({
  video: BILIBILI_VIDEO_COMMENT_TYPE,
  album: BILIBILI_ALBUM_COMMENT_TYPE,
  article: BILIBILI_ARTICLE_COMMENT_TYPE,
  dynamic: BILIBILI_DYNAMIC_COMMENT_TYPE,
});

export function commentTypeOf(kind: BilibiliResourceKind): number {
  return COMMENT_TYPE_OF[kind];
}

/** 评论区 type → 资源种类；不支持的 type 返回 undefined。 */
export function resourceKindOfCommentType(type: number): BilibiliResourceKind | undefined {
  switch (type) {
    case BILIBILI_VIDEO_COMMENT_TYPE: return 'video';
    case BILIBILI_ALBUM_COMMENT_TYPE: return 'album';
    case BILIBILI_ARTICLE_COMMENT_TYPE: return 'article';
    case BILIBILI_DYNAMIC_COMMENT_TYPE: return 'dynamic';
    default: return undefined;
  }
}

/** 一个已解析的评论区：`x/v2/reply` / `x/v2/reply/add` 用的 (type, oid)。 */
export interface BilibiliCommentArea {
  readonly kind: BilibiliResourceKind;
  readonly type: number;
  /** 评论区 oid（十进制字符串；动态 id 超过 2^53，绝不能转成 number）。 */
  readonly oid: string;
  /** 来自动态白名单时的原始动态 id（用于链接与展示）。 */
  readonly dynamicId?: string;
}
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
/**
 * 通知入站范围：`whitelist` 只收白名单评论区（视频 / 动态 / 专栏）下的通知（默认）；
 * `all` 收所有视频评论通知，以及已配置 `dynamics` / `articles` 时对应种类的全部评论通知。
 */
export type BilibiliNotificationScope = 'whitelist' | 'all';

/** One endpoint config after AdapterIndex expands `<instanceKey>.endpoints`. */
export interface BilibiliEndpointConfig extends EndpointProfileConfiguration {
  readonly id: string;
  /** @internal Assigned only for fresh Adapter identities; imported records retain their original data path. */
  readonly stateDirectoryId?: string;
  /** Cookie SESSDATA（请用 ${ENV} 注入，切勿写进仓库）。 */
  readonly sessdata?: string;
  /** Cookie bili_jct（即 csrf token）。 */
  readonly biliJct?: string;
  /** 白名单视频：BV 号或 av 号（`BV1xx...` / `av123` / `123`）。 */
  readonly videos?: readonly (string | number)[];
  /** 白名单动态：动态 id（`t.bilibili.com/<id>` / `bilibili.com/opus/<id>` 里的数字）。请写成字符串。 */
  readonly dynamics?: readonly (string | number)[];
  /** 白名单专栏：cv 号（`cv123` / `123`）。 */
  readonly articles?: readonly (string | number)[];
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
  /** 草稿与扫码登录凭据的本地目录（默认 `data/bilibili`，相对进程工作目录）。不要放进仓库。 */
  readonly dataDir?: string;
  /** 新草稿 / 登录失效时主动提醒到哪个聊天会话（可选）。 */
  readonly notify?: BilibiliNotifyTarget;
  readonly apiBaseUrl?: string;
  /** 扫码登录接口地址（测试用）。 */
  readonly passportBaseUrl?: string;
}

/** 主动提醒目标：另一个已接入聊天平台里的会话（通常是你和机器人的私聊）。 */
export interface BilibiliNotifyTarget {
  /** 适配器名，如 `icqq` / `telegram`。 */
  readonly adapter: string;
  /** 该适配器的 endpoint id（配置里的 endpoints[i].id）。 */
  readonly endpoint: string;
  /** 会话类型，默认 `private`。 */
  readonly kind?: 'private' | 'group' | 'channel';
  /** 会话 id：私聊填你的账号，群聊填群号。 */
  readonly id: string | number;
}

export interface ResolvedBilibiliConfig {
  readonly context: 'bilibili';
  readonly id: string;
  readonly stateDirectoryId?: string;
  readonly sessdata?: string;
  readonly biliJct?: string;
  readonly videos: readonly BilibiliVideoRef[];
  /** 白名单动态 id（十进制字符串）。 */
  readonly dynamics: readonly string[];
  /** 白名单专栏 cvid（十进制字符串）。 */
  readonly articles: readonly string[];
  readonly pollIntervalMs: number;
  readonly sendMode: BilibiliSendMode;
  readonly minSendIntervalMs: number;
  readonly notifications: readonly BilibiliNotificationKind[];
  readonly notificationScope: BilibiliNotificationScope;
  readonly dataDir: string;
  readonly notify?: ResolvedBilibiliNotifyTarget;
  readonly apiBaseUrl: string;
  readonly passportBaseUrl: string;
}

export interface ResolvedBilibiliNotifyTarget {
  readonly adapter: string;
  readonly endpoint: string;
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
}

export const BILIBILI_DEFAULT_DATA_DIR = 'data/bilibili';

function resolveNotifyTarget(value: BilibiliNotifyTarget | undefined): ResolvedBilibiliNotifyTarget | undefined {
  if (value === undefined || value === null) return undefined;
  const adapter = typeof value.adapter === 'string' ? value.adapter.trim() : '';
  const endpoint = typeof value.endpoint === 'string' ? value.endpoint.trim() : String(value.endpoint ?? '').trim();
  const id = String(value.id ?? '').trim();
  const kind = value.kind ?? 'private';
  if (!adapter || !endpoint || !id) throw new TypeError('Bilibili notify requires adapter, endpoint and id');
  if (kind !== 'private' && kind !== 'group' && kind !== 'channel') {
    throw new TypeError(`Bilibili notify.kind must be private, group or channel, got "${String(kind)}"`);
  }
  return Object.freeze({ adapter, endpoint, kind, id });
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

/**
 * 动态 id：只收纯数字。动态 id 是 18–19 位、超过 Number.MAX_SAFE_INTEGER，
 * YAML 里不加引号会被解析成有精度损失的 number，这里直接拒绝，避免回复到错误的评论区。
 */
export function parseDynamicRef(value: string | number): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError(`Bilibili dynamic id ${String(value)} lost precision; quote it as a string in the config`);
  }
  const raw = String(value).trim();
  if (/^[1-9]\d{0,19}$/.test(raw)) return raw;
  throw new TypeError(`Bilibili dynamic must be a numeric dynamic id, got "${raw}"`);
}

/** 专栏：`cv123` / `123`。 */
export function parseArticleRef(value: string | number): string {
  const raw = String(value).trim();
  const cv = /^(?:cv)?([1-9]\d*)$/i.exec(raw);
  if (cv && Number.isSafeInteger(Number(cv[1]))) return cv[1]!;
  throw new TypeError(`Bilibili article must be a cv id or number, got "${raw}"`);
}

function uniqueRefs(values: readonly (string | number)[] | undefined, parse: (value: string | number) => string): string[] {
  return [...new Set((values ?? []).map(parse))];
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
  const notify = resolveNotifyTarget(config.notify);
  return {
    context: 'bilibili',
    id,
    ...(config.stateDirectoryId ? { stateDirectoryId: config.stateDirectoryId } : {}),
    ...(sessdata ? { sessdata } : {}),
    ...(biliJct ? { biliJct } : {}),
    videos: (config.videos ?? []).map(parseVideoRef),
    dynamics: Object.freeze(uniqueRefs(config.dynamics, parseDynamicRef)),
    articles: Object.freeze(uniqueRefs(config.articles, parseArticleRef)),
    pollIntervalMs: interval * 1000,
    sendMode,
    minSendIntervalMs: sendInterval * 1000,
    notifications: Object.freeze(notifications),
    notificationScope,
    dataDir: config.dataDir?.trim() || BILIBILI_DEFAULT_DATA_DIR,
    ...(notify ? { notify } : {}),
    apiBaseUrl: trimTrailingSlashes(config.apiBaseUrl?.trim() || 'https://api.bilibili.com'),
    passportBaseUrl: trimTrailingSlashes(config.passportBaseUrl?.trim() || 'https://passport.bilibili.com'),
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
  return resourceId('video', aid);
}

/** 评论区资源会话 id（评论楼的 parent）：`<kind>:<oid>`。 */
export function resourceId(kind: BilibiliResourceKind, oid: string | number): string {
  return `${kind}:${oid}`;
}

/** 评论楼会话 id：`<kind>:<oid>:<rootRpid>`；kind 省略时为 `video`（兼容 v1）。 */
export function threadConversationId(oid: string | number, rootRpid: string | number, kind: BilibiliResourceKind = 'video'): string {
  return `${resourceId(kind, oid)}:${rootRpid}`;
}

export interface ParsedThreadId {
  /** 资源种类（conversation id 前缀）。 */
  readonly type: BilibiliResourceKind;
  /** 评论区 type（1 / 11 / 12 / 17）。 */
  readonly commentType: number;
  readonly oid: string;
  readonly root: string;
}

export function parseThreadConversationId(id: string): ParsedThreadId | undefined {
  const match = /^(video|album|article|dynamic):([1-9]\d{0,19}):([1-9]\d{0,19})$/.exec(id);
  if (!match) return undefined;
  const kind = match[1] as BilibiliResourceKind;
  return { type: kind, commentType: commentTypeOf(kind), oid: match[2]!, root: match[3]! };
}

export function bilibiliThreadConversation(
  endpointKey: string,
  oid: string | number,
  rootRpid: string | number,
  kind: BilibiliResourceKind = 'video',
): ConversationRef {
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind: 'channel',
    id: threadConversationId(oid, rootRpid, kind),
    parent: { kind: 'channel', id: resourceId(kind, oid) },
  };
}

/** `x/polymer/web-dynamic/v1/detail` 里我们用到的字段。 */
export interface BilibiliDynamicDetail {
  readonly item?: {
    readonly id_str?: string;
    readonly type?: string;
    readonly basic?: {
      readonly comment_type?: number;
      readonly comment_id_str?: string;
      readonly rid_str?: string;
    };
  } | null;
}

export type BilibiliDynamicResolution =
  | { readonly ok: true; readonly area: BilibiliCommentArea }
  | { readonly ok: false; readonly reason: string };

/**
 * 动态 id → 评论区 (type, oid)。只信平台在 `basic.comment_type` / `basic.comment_id_str` 里声明的评论区：
 * - 17（纯文字 / 转发 / 直播开播等）：oid 一般就是动态 id
 * - 11（带图动态）：oid 是相簿 id，**不是**动态 id
 * 视频动态（1）、专栏动态（12）等不在 `dynamics` 里处理（请分别填到 `videos` / `articles`），其它形状一律拒绝。
 */
export function resolveDynamicCommentArea(dynamicId: string, detail: BilibiliDynamicDetail | null | undefined): BilibiliDynamicResolution {
  const item = detail?.item;
  if (!item) return { ok: false, reason: 'dynamic detail has no item' };
  if (item.id_str !== undefined && item.id_str !== dynamicId) {
    return { ok: false, reason: `dynamic detail id ${String(item.id_str)} does not match ${dynamicId}` };
  }
  const type = Number(item.basic?.comment_type);
  const oid = String(item.basic?.comment_id_str ?? '').trim();
  if (!/^[1-9]\d{0,19}$/.test(oid)) return { ok: false, reason: `dynamic ${dynamicId} has no commentable id (${item.type ?? 'unknown type'})` };
  switch (type) {
    case BILIBILI_DYNAMIC_COMMENT_TYPE:
      return { ok: true, area: Object.freeze({ kind: 'dynamic' as const, type, oid, dynamicId }) };
    case BILIBILI_ALBUM_COMMENT_TYPE:
      return { ok: true, area: Object.freeze({ kind: 'album' as const, type, oid, dynamicId }) };
    case BILIBILI_VIDEO_COMMENT_TYPE:
      return { ok: false, reason: `dynamic ${dynamicId} is a video post (av${oid}); add it to videos instead` };
    case BILIBILI_ARTICLE_COMMENT_TYPE:
      return { ok: false, reason: `dynamic ${dynamicId} is an article post (cv${oid}); add it to articles instead` };
    default:
      return { ok: false, reason: `dynamic ${dynamicId} uses unsupported comment type ${Number.isFinite(type) ? type : 'unknown'} (${item.type ?? 'unknown type'})` };
  }
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
    /** 评论区 type：1 视频、11 图文动态、12 专栏、17 文字动态；其余忽略。 */
    readonly business_id?: number;
    /** 评论区 oid（视频即 aid）。文字动态是 19 位动态 id，JSON 解析后可能丢精度。 */
    readonly subject_id?: number;
    /** 根评论 rpid；0 表示通知里的评论本身是一级评论。 */
    readonly root_id?: number;
    /** 触发通知的这条评论 rpid。 */
    readonly source_id?: number;
    /** 被回复的评论 rpid（@ 通知里通常为 0）。 */
    readonly target_id?: number;
    readonly source_content?: string;
    /** Web 跳转链接，如 `https://www.bilibili.com/opus/<动态id>#reply<rpid>`。 */
    readonly uri?: string;
    readonly native_uri?: string;
  };
  readonly reply_time?: number;
  readonly at_time?: number;
}

export interface BilibiliNotificationPage {
  readonly items?: readonly BilibiliNotificationItem[] | null;
  readonly cursor?: { readonly is_end?: boolean; readonly id?: number; readonly time?: number };
}

/** 从通知跳转链接里取动态 id 原文（避免 19 位数字经 JSON number 丢精度）。 */
function dynamicIdFromUri(item: NonNullable<BilibiliNotificationItem['item']>): string | undefined {
  for (const uri of [item.uri, item.native_uri]) {
    if (typeof uri !== 'string') continue;
    const match = /(?:bilibili\.com\/opus\/|t\.bilibili\.com\/|opus\/detail\/|bilibili\.com\/dynamic\/)(\d{1,20})(?!\d)/.exec(uri);
    if (match) return match[1];
  }
  return undefined;
}

/** 通知里评论区 oid 的精确十进制字符串；无法确定时返回 undefined（宁可丢弃，也不回错楼）。 */
function notificationOid(type: number, item: NonNullable<BilibiliNotificationItem['item']>): string | undefined {
  const subject = Number(item.subject_id);
  if (!Number.isFinite(subject) || subject <= 0) return undefined;
  if (Number.isSafeInteger(subject)) return String(subject);
  if (type !== BILIBILI_DYNAMIC_COMMENT_TYPE) return undefined;
  const fromUri = dynamicIdFromUri(item);
  // 链接里的 id 必须和（已丢精度的）subject_id 是同一个数，才认。
  return fromUri !== undefined && Number(fromUri) === subject ? fromUri : undefined;
}

export interface BilibiliNotificationReply {
  readonly area: BilibiliCommentArea;
  readonly reply: BilibiliReply;
}

/**
 * 把一条评论通知还原成 (评论区, 评论)。`kinds` 限定接受的评论区种类（默认只收视频，兼容 v1）；
 * 不支持的业务 / 缺字段 / oid 无法精确还原时返回 undefined。
 */
export function notificationToComment(
  entry: BilibiliNotificationItem,
  kinds: ReadonlySet<BilibiliResourceKind> = new Set(['video']),
): BilibiliNotificationReply | undefined {
  const item = entry.item;
  if (!item) return undefined;
  if (item.type !== undefined && item.type !== 'reply') return undefined;
  const type = Number(item.business_id);
  const kind = resourceKindOfCommentType(type);
  if (!kind || !kinds.has(kind)) return undefined;
  const rpid = Number(item.source_id);
  const mid = Number(entry.user?.mid);
  const oid = notificationOid(type, item);
  if (!rpid || !Number.isSafeInteger(rpid) || !oid || !mid) return undefined;
  const root = Number(item.root_id) || 0;
  return {
    area: Object.freeze({ kind, type, oid }),
    reply: {
      rpid,
      oid: Number(oid),
      type,
      mid,
      root,
      parent: Number(item.target_id) || root,
      ctime: Number(entry.reply_time ?? entry.at_time ?? 0),
      member: { mid: String(mid), ...(entry.user?.nickname ? { uname: entry.user.nickname } : {}) },
      content: { message: item.source_content ?? '' },
    },
  };
}

/** 把一条视频评论通知还原成评论结构；非视频评论 / 缺字段时返回 undefined（v1 兼容入口）。 */
export function notificationToReply(entry: BilibiliNotificationItem): BilibiliReply | undefined {
  return notificationToComment(entry)?.reply;
}

/** 评论区上某条评论的网页链接。图文动态优先用动态 id，未知时退回相簿页。 */
export function commentAreaUrl(area: { readonly type?: number; readonly oid: string; readonly dynamicId?: string }, rpid: string): string {
  switch (area.type ?? BILIBILI_VIDEO_COMMENT_TYPE) {
    case BILIBILI_ARTICLE_COMMENT_TYPE: return `https://www.bilibili.com/read/cv${area.oid}#reply${rpid}`;
    case BILIBILI_DYNAMIC_COMMENT_TYPE: return `https://t.bilibili.com/${area.dynamicId ?? area.oid}#reply${rpid}`;
    case BILIBILI_ALBUM_COMMENT_TYPE:
      return area.dynamicId ? `https://t.bilibili.com/${area.dynamicId}#reply${rpid}` : `https://h.bilibili.com/${area.oid}#reply${rpid}`;
    default: return `https://www.bilibili.com/video/av${area.oid}#reply${rpid}`;
  }
}

/** 评论区的简短标签（Console / 草稿展示）。 */
export function commentAreaLabel(area: { readonly type?: number; readonly oid: string; readonly dynamicId?: string }): string {
  switch (area.type ?? BILIBILI_VIDEO_COMMENT_TYPE) {
    case BILIBILI_ARTICLE_COMMENT_TYPE: return `cv${area.oid}`;
    case BILIBILI_DYNAMIC_COMMENT_TYPE: return `dynamic ${area.dynamicId ?? area.oid}`;
    case BILIBILI_ALBUM_COMMENT_TYPE: return area.dynamicId ? `dynamic ${area.dynamicId}` : `album ${area.oid}`;
    default: return `av${area.oid}`;
  }
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
