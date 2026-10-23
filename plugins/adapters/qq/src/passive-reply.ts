/**
 * Passive replies on the QQ open platform.
 *
 * A message sent with the `msg_id` of a recent user message (or the `event_id` of a recent event)
 * is a passive reply; without one it is an active message, which has quotas and can be switched
 * off by the user. Each source may be replied to a limited number of times within a window, and
 * `msg_seq` must differ for every reply to the same source. The ledger remembers recent sources
 * per conversation and hands out the newest one still usable, with its next `msg_seq`.
 *
 * Limits from https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html
 */
import type { QqChannelKind as QqOutboundKind } from './protocol.js';

/** Reply-to source for the SDK: a user message id or an event id. */
export type QqReplySource = { readonly id: string } | { readonly event_id: string };

export interface QqPassiveLimit {
  readonly windowMs: number;
  readonly maxReplies: number;
}

/** C2C: 60 min, 4 replies. Group: 5 min, 5 replies. Guild channel and DM: 5 min (count unpublished; 5 assumed). */
export const QQ_PASSIVE_LIMITS: Readonly<Record<QqOutboundKind, QqPassiveLimit>> = Object.freeze({
  private: { windowMs: 60 * 60_000, maxReplies: 4 },
  group: { windowMs: 5 * 60_000, maxReplies: 5 },
  channel: { windowMs: 5 * 60_000, maxReplies: 5 },
  direct: { windowMs: 5 * 60_000, maxReplies: 5 },
});

/** Stop using a source this long before the platform window closes: the request itself takes time. */
const SAFETY_MARGIN_MS = 15_000;
/** Sources remembered per conversation; older ones are long expired in practice. */
const MAX_SOURCES_PER_CONVERSATION = 8;

interface SourceEntry {
  readonly source: QqReplySource;
  readonly receivedAt: number;
  replies: number;
  exhausted: boolean;
}

export interface PassiveReplyGrant {
  readonly source: QqReplySource;
  readonly msgSeq: number;
}

function sourceKey(source: QqReplySource): string {
  return 'id' in source ? `msg:${source.id}` : `event:${source.event_id}`;
}

/** Expired conversations are dropped every this many records. */
const PRUNE_EVERY_RECORDS = 256;

export class QqPassiveReplyLedger {
  readonly #conversations = new Map<string, SourceEntry[]>();
  #records = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** A user message or event in `conversation` that later replies may answer. */
  record(kind: QqOutboundKind, conversationId: string, source: QqReplySource, receivedAt = this.now()): void {
    const key = `${kind}:${conversationId}`;
    const entries = (this.#conversations.get(key) ?? []).filter(entry => sourceKey(entry.source) !== sourceKey(source));
    entries.push({ source, receivedAt, replies: 0, exhausted: false });
    entries.sort((a, b) => a.receivedAt - b.receivedAt);
    this.#conversations.set(key, entries.slice(-MAX_SOURCES_PER_CONVERSATION));
    if (++this.#records % PRUNE_EVERY_RECORDS === 0) this.prune();
  }

  /**
   * Claim one reply: `preferred` (an explicit reply segment) when it is still usable, otherwise the
   * newest usable source in the conversation. Undefined when only an active message is possible.
   */
  acquire(kind: QqOutboundKind, conversationId: string, preferred?: QqReplySource): PassiveReplyGrant | undefined {
    const limit = QQ_PASSIVE_LIMITS[kind];
    const now = this.now();
    const entries = this.#conversations.get(`${kind}:${conversationId}`) ?? [];
    const usable = (entry: SourceEntry) => !entry.exhausted
      && entry.replies < limit.maxReplies
      && now - entry.receivedAt < limit.windowMs - SAFETY_MARGIN_MS;
    const preferredKey = preferred ? sourceKey(preferred) : undefined;
    const entry = (preferredKey ? entries.find(item => sourceKey(item.source) === preferredKey && usable(item)) : undefined)
      ?? [...entries].reverse().find(usable);
    if (!entry) return undefined;
    entry.replies += 1;
    return { source: entry.source, msgSeq: entry.replies };
  }

  /** The platform said this source can no longer be replied to (expired, over the limit, invalid id). */
  exhaust(kind: QqOutboundKind, conversationId: string, source: QqReplySource): void {
    const key = sourceKey(source);
    const entry = this.#conversations.get(`${kind}:${conversationId}`)?.find(item => sourceKey(item.source) === key);
    if (entry) entry.exhausted = true;
  }

  /** Drop conversations whose every source is past its window. */
  prune(): void {
    const now = this.now();
    for (const [key, entries] of this.#conversations) {
      const kind = key.slice(0, key.indexOf(':')) as QqOutboundKind;
      const windowMs = QQ_PASSIVE_LIMITS[kind]?.windowMs ?? 0;
      const live = entries.filter(entry => now - entry.receivedAt < windowMs);
      if (live.length === 0) this.#conversations.delete(key);
      else this.#conversations.set(key, live);
    }
  }
}

/** Platform codes meaning the reply source is unusable: switch to an active message. */
export const QQ_PASSIVE_SOURCE_CODES: ReadonlySet<number> = new Set([
  40034128, // 被动回复时间或次数超限
  40034005, // 回复消息 msg_id 已过期
  304027, // MSG_EXPIRE 回复的消息过期
  304026, // MSG_ID 回复的消息 id 错误
  306002, // msgid error
  501005, 501008, 501009, // MessageID 错误 / 不存在 / 解析失败
]);

/** Platform codes meaning active messages are unavailable for this conversation for now. */
export const QQ_ACTIVE_UNAVAILABLE_CODES: ReadonlySet<number> = new Set([
  40034105, // 主动消息发送失败，无权限
  304031, 304032, 304034, // 私信已关闭 / 不存在 / 不是私信成员
  304035, 304045, 304047, 304049, 304050, // 主动消息额度、频控
  304046, 304048, // 不允许在此（子）频道发主动消息
]);

/** Platform codes meaning Markdown is not allowed: resend as plain text. */
export const QQ_MARKDOWN_DENIED_CODES: ReadonlySet<number> = new Set([
  304036, // 没有 markdown 模板的权限
  304014, // TEMPLATE_PRIVILEGE 没有模板权限
  50056, // 不允许发送 markdown content
]);

/** How long a conversation is not offered active messages after the platform refused them. */
export const ACTIVE_UNAVAILABLE_BACKOFF_MS = 60 * 60_000;

/** Conversations where the platform recently refused active messages. */
export class QqActiveMessageGate {
  readonly #blockedUntil = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  blocked(kind: QqOutboundKind, conversationId: string): boolean {
    const key = `${kind}:${conversationId}`;
    const until = this.#blockedUntil.get(key);
    if (until === undefined) return false;
    if (this.now() < until) return true;
    this.#blockedUntil.delete(key);
    return false;
  }

  /** Returns true the first time a conversation is blocked, so the caller can log it once. */
  block(kind: QqOutboundKind, conversationId: string): boolean {
    const key = `${kind}:${conversationId}`;
    const fresh = !this.blocked(kind, conversationId);
    this.#blockedUntil.set(key, this.now() + ACTIVE_UNAVAILABLE_BACKOFF_MS);
    return fresh;
  }
}
