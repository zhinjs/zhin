import type { Locale } from 'zhin.js/i18n';
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';
import type { MusicInfo, MusicSource } from './types.js';

export interface PendingSearch {
  readonly locale?: Locale;
  readonly results: readonly MusicInfo[];
  readonly source: MusicSource;
  readonly keyword: string;
  readonly timestamp: number;
}

const SEARCH_TIMEOUT_MS = 3 * 60 * 1000;

export function sessionKey(
  conversation: ConversationRef,
  senderId: string,
): string {
  return JSON.stringify([conversationRefKey(conversation), senderId]);
}

export function resolveMessageIds(input: {
  metadata?: Record<string, unknown>;
  conversation?: ConversationRef;
  sender?: { id?: unknown };
} | undefined): { conversation: ConversationRef; senderId: string } | null {
  const conversation = input?.conversation;
  const senderId = input?.sender?.id;
  if (!conversation?.endpoint?.id || !conversation.endpoint.adapter || !conversation.id
    || !['private', 'group', 'channel'].includes(conversation.kind)
    || typeof senderId !== 'string' || !senderId) return null;
  return { conversation, senderId };
}

/** Generation-owned pending music selections. */
export class MusicSearchSessions {
  readonly #pending = new Map<string, PendingSearch>();
  readonly #timeoutMs: number;
  readonly #now: () => number;

  constructor(
    timeoutMs = SEARCH_TIMEOUT_MS,
    now: () => number = Date.now,
  ) {
    this.#timeoutMs = timeoutMs;
    this.#now = now;
  }

  set(key: string, search: PendingSearch): void {
    this.#pending.set(key, search);
  }

  get(key: string): PendingSearch | undefined {
    const session = this.#pending.get(key);
    if (!session) return undefined;
    if (this.#now() - session.timestamp > this.#timeoutMs) {
      this.#pending.delete(key);
      return undefined;
    }
    return session;
  }

  delete(key: string): void {
    this.#pending.delete(key);
  }

  pruneExpired(): void {
    const now = this.#now();
    for (const [key, session] of this.#pending) {
      if (now - session.timestamp > this.#timeoutMs) {
        this.#pending.delete(key);
      }
    }
  }

  dispose(): void {
    this.#pending.clear();
  }
}
