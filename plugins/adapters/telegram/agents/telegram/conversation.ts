import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type TelegramToolContext = ToolExecutionContext<unknown, 'telegram'>;

/**
 * The trusted turn owns the chat; model input cannot select another one. Platform (`platform:*`) and
 * Bot (`bot:*`) permits are judged in the current conversation, so administration tools that rely on
 * them must act on the current chat only (ADR 0056 §5).
 */
export function currentChat(context: TelegramToolContext, options: { readonly allowPrivate?: boolean } = {}): number {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'telegram' ? origin.conversation : undefined;
  const id = Number(conversation?.id);
  if (!conversation || (conversation.kind === 'private' && !options.allowPrivate) || !Number.isSafeInteger(id) || id === 0) {
    throw new Error(t(context.locale, options.allowPrivate ? 'conversationRequired' : 'chatRequired'));
  }
  context.signal?.throwIfAborted();
  return id;
}
