import { createHash } from 'node:crypto';
import type { ConversationRef, DeliveryReceipt } from '@zhin.js/im-contract';
import { segmentsToPlainText } from '../../built/segment-contract/text.js';
import type { Segment } from '../../built/segment-contract/types.js';

/**
 * @internal 出站 ledger：入站 origin 判定的关联层兜底。
 *
 * 只保存 message id 与文本摘要（不存原文），有界内存、短 TTL。
 * 写入发生在 `deliver` 成功之后的旁路，失败不影响 receipt。
 */

const MAX_ENTRIES = 2000;
const TTL_MS = 10 * 60_000;
const DIGEST_WINDOW_MS = 30_000;
const MIN_DIGEST_TEXT = 4;

interface LedgerEntry {
  readonly scope: string;
  readonly endpointId: string;
  readonly messageId?: string;
  readonly digest?: string;
  readonly at: number;
  digestConsumed: boolean;
}

/**
 * scope 键不含 endpoint id：同一个群里不同 Bot 的 conversationRefKey 不同，
 * 但它们互相的回显仍属同一会话。
 */
export function ledgerScopeOf(conversation: ConversationRef): string {
  return [
    conversation.endpoint.adapter,
    conversation.kind,
    conversation.id,
    conversation.parent?.kind ?? '',
    conversation.parent?.id ?? '',
    conversation.threadId ?? '',
  ].join('\0');
}

export function digestText(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < MIN_DIGEST_TEXT) return undefined;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function payloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) {
    return segmentsToPlainText(payload.filter(
      (item): item is Segment => !!item && typeof item === 'object' && typeof (item as Segment).type === 'string',
    ));
  }
  return '';
}

export interface LedgerMatch {
  readonly endpointId: string;
}

export class OutboundLedger {
  readonly #entries: LedgerEntry[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.#entries.length;
  }

  /** 仅在 `receipt.status === 'sent'` 时记录；`payload` 应为最终投影后的 payload。 */
  record(conversation: ConversationRef, receipt: DeliveryReceipt, payload: unknown): void {
    if (receipt.status !== 'sent') return;
    const at = this.now();
    this.#prune(at);
    const rawId = receipt.message?.id;
    const messageId = rawId === undefined || rawId === null || String(rawId) === '' ? undefined : String(rawId);
    const digest = digestText(payloadText(payload));
    if (messageId === undefined && digest === undefined) return;
    this.#entries.push({
      scope: ledgerScopeOf(conversation),
      endpointId: conversation.endpoint.id,
      ...(messageId !== undefined ? { messageId } : {}),
      ...(digest !== undefined ? { digest } : {}),
      at,
      digestConsumed: false,
    });
    while (this.#entries.length > MAX_ENTRIES) this.#entries.shift();
  }

  matchById(scope: string, messageId: unknown): LedgerMatch | undefined {
    if (typeof messageId !== 'string' && typeof messageId !== 'number') return undefined;
    const id = String(messageId);
    if (id === '') return undefined;
    const at = this.now();
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const entry = this.#entries[i]!;
      if (at - entry.at > TTL_MS) continue;
      if (entry.scope === scope && entry.messageId === id) return { endpointId: entry.endpointId };
    }
    return undefined;
  }

  /**
   * 摘要兜底（“账号 id 对不上”时）：30 秒窗口、一次性。
   * 权衡：人类在窗口内原样复读 Bot 刚发的文本，会被当作回显丢弃一次。
   */
  matchByDigest(scope: string, text: string, now: number = this.now()): LedgerMatch | undefined {
    const digest = digestText(typeof text === 'string' ? text : '');
    if (digest === undefined) return undefined;
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const entry = this.#entries[i]!;
      if (now - entry.at > DIGEST_WINDOW_MS) continue;
      if (entry.digestConsumed || entry.scope !== scope || entry.digest !== digest) continue;
      entry.digestConsumed = true;
      return { endpointId: entry.endpointId };
    }
    return undefined;
  }

  #prune(at: number): void {
    let drop = 0;
    while (drop < this.#entries.length && at - this.#entries[drop]!.at > TTL_MS) drop++;
    if (drop > 0) this.#entries.splice(0, drop);
  }
}
