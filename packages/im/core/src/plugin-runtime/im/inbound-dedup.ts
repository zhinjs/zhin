import type { ConversationRef } from '@zhin.js/im-contract';
import { ledgerScopeOf } from './outbound-ledger.js';

/**
 * @internal 入站去重：同一条人类群消息会到达 N 个成员 Endpoint，
 * 按 平台 + 会话 + 发送者 + 平台消息 id 只放行第一个 Endpoint，其余仅记录。
 *
 * 只对 group / channel 生效。私聊刻意排除：部分平台（如 OneBot）的消息 id 是
 * 账号级的，两个 Bot 在同一私聊里可能拿到相同 id 的不同消息，去重会误合并。
 * 缺少发送者或消息 id 时同样不去重（保持原有路由行为）。
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 2000;

export type InboundClaim = 'first' | 'same_endpoint' | 'duplicate' | 'unkeyed';

interface ClaimEntry {
  readonly endpointId: string;
  readonly at: number;
}

export class InboundDeduper {
  readonly #entries = new Map<string, ClaimEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.#entries.size;
  }

  /**
   * 不变量：本方法完全同步，调用方必须在任何 await 之前调用，
   * 这样 N 个 Endpoint 的并发到达会被原子地判定。
   */
  claim(conversation: ConversationRef, senderId: string, messageId: unknown): InboundClaim {
    if (conversation.kind !== 'group' && conversation.kind !== 'channel') return 'unkeyed';
    if (typeof senderId !== 'string' || senderId === '') return 'unkeyed';
    if (typeof messageId !== 'string' && typeof messageId !== 'number') return 'unkeyed';
    const id = String(messageId);
    if (id === '') return 'unkeyed';
    const key = `${ledgerScopeOf(conversation)}\0${senderId}\0${id}`;
    const at = this.now();
    this.#prune(at);
    const existing = this.#entries.get(key);
    if (existing) {
      return existing.endpointId === conversation.endpoint.id ? 'same_endpoint' : 'duplicate';
    }
    this.#entries.set(key, { endpointId: conversation.endpoint.id, at });
    while (this.#entries.size > MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return 'first';
  }

  #prune(at: number): void {
    for (const [key, entry] of this.#entries) {
      if (at - entry.at <= TTL_MS) break;
      this.#entries.delete(key);
    }
  }
}
