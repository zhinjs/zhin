import type { MusicInfo, MusicSource } from './types.js';

export interface PendingSearch {
  readonly results: readonly MusicInfo[];
  readonly source: MusicSource;
  readonly keyword: string;
  readonly timestamp: number;
}

const SEARCH_TIMEOUT_MS = 3 * 60 * 1000;

const pendingSessions = new Map<string, PendingSearch>();

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

export function setPending(key: string, search: PendingSearch): void {
  pendingSessions.set(key, search);
}

export function getPending(key: string): PendingSearch | undefined {
  const session = pendingSessions.get(key);
  if (!session) return undefined;
  if (Date.now() - session.timestamp > SEARCH_TIMEOUT_MS) {
    pendingSessions.delete(key);
    return undefined;
  }
  return session;
}

export function clearPending(key: string): void {
  pendingSessions.delete(key);
}

export function cleanExpired(): void {
  const now = Date.now();
  for (const [key, session] of pendingSessions) {
    if (now - session.timestamp > SEARCH_TIMEOUT_MS) {
      pendingSessions.delete(key);
    }
  }
}
