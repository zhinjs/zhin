import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type LarkToolContext = ToolExecutionContext<unknown, 'lark'>;

/**
 * The trusted turn owns the chat; model input cannot select another one. Platform (`platform:*`) and
 * Bot (`bot:*`) permits are judged in the current conversation, so group administration tools act on
 * the current group only (ADR 0056 §5).
 */
export function currentChat(context: LarkToolContext): string {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'lark' ? origin.conversation : undefined;
  if (!conversation || conversation.kind !== 'group') throw new Error(t(context.locale, 'groupRequired'));
  context.signal?.throwIfAborted();
  return conversation.id;
}
