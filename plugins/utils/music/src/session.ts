import type { MusicInfo, MusicSource } from './types.js';

export interface PendingSearch {
  readonly results: readonly MusicInfo[];
  readonly source: MusicSource;
  readonly keyword: string;
  readonly timestamp: number;
}

const SEARCH_TIMEOUT_MS = 3 * 60 * 1000;

export function sessionKey(
  endpointId: string,
  conversationId: string,
  senderId: string,
): string {
  return `${endpointId}:${conversationId}:${senderId}`;
}

export function resolveMessageIds(input: {
  metadata?: Record<string, unknown>;
  conversation?: { id?: unknown; endpoint?: { id?: unknown } };
  sender?: { id?: unknown };
}): { endpointId: string; conversationId: string; senderId: string } | null {
  const meta = input.metadata ?? {};
  const endpointId = String(meta.endpointId ?? input.conversation?.endpoint?.id ?? '');
  const conversationId = String(input.conversation?.id ?? '');
  const senderId = String(input.sender?.id ?? '');
  if (!endpointId || !conversationId || !senderId) return null;
  return { endpointId, conversationId, senderId };
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
