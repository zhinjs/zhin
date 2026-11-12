import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type NapcatToolContext = ToolExecutionContext<unknown, 'napcat'>;

/**
 * The trusted turn owns the group; model input cannot select another one. Platform (`platform:*`) and
 * Bot (`bot:*`) permits are judged in the current conversation, so group administration tools act on
 * the current group only (ADR 0056 §5).
 */
export function currentGroup(context: NapcatToolContext): number {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'napcat' ? origin.conversation : undefined;
  if (!conversation || conversation.kind !== 'group') throw new Error(t(context.locale, 'groupRequired'));
  context.signal?.throwIfAborted();
  return Number(conversation.id);
}

/** OneBot message ids are account-wide: verify the message belongs to the current group before acting on it. */
export async function requireMessageInGroup(context: NapcatToolContext, groupId: number, messageId: number): Promise<void> {
  const message = await context.$client.callApi('get_msg', { message_id: messageId }) as { group_id?: unknown; message_type?: unknown } | undefined;
  context.signal?.throwIfAborted();
  if (message?.message_type !== 'group' || Number(message.group_id) !== groupId) {
    throw new Error(t(context.locale, 'messageOutsideGroup'));
  }
}
