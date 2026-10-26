import { messages as t } from './i18n.js';
import { conversationKey, requireConversation, type ConversationInput } from './conversation-scope.js';
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ts(): string {
  return new Date().toISOString();
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Every scene includes endpoint, parent and thread; no cross-bot global fallback. */
export function resolveContextKey(input: ConversationInput): { type: string; id: string } {
  const target = requireConversation(input);
  return { type: target.kind, id: conversationKey(target) };
}

export function resolveSender(input: {
  readonly locale?: import('zhin.js/i18n').Locale;
  sender?: { readonly id: string; readonly name?: string };
  metadata?: Readonly<Record<string, unknown>>;
}): { id: string; name: string } {
  const meta = input.metadata ?? {};
  const id = input.sender?.id ?? String(meta.senderId ?? '');
  const name = input.sender?.name ?? String(meta.senderName ?? meta.name ?? t(input.locale, 'user'));
  return { id, name };
}
