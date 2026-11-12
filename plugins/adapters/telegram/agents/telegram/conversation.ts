import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type TelegramToolContext = ToolExecutionContext<unknown, 'telegram'>;

/**
 * The trusted turn owns the chat; model input cannot select another one. Platform (`platform:*`) and
 * Bot (`bot:*`) permits are judged in the current conversation, so administration tools that rely on
 * them must act on the current chat only (ADR 0056 §5).
 */
export function currentChat(context: TelegramToolContext): number {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'telegram' ? origin.conversation : undefined;
  if (!conversation || conversation.kind === 'private') throw new Error(t(context.locale, 'chatRequired'));
  context.signal?.throwIfAborted();
  return Number(conversation.id);
}
