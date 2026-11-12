import { outboundMessageToken, type SendContent } from '@zhin.js/core/runtime';
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

/** The current conversation as a OneBot target: the group, or the private peer (QQ number). */
export function currentTarget(context: NapcatToolContext): { readonly type: 'group' | 'private'; readonly id: number } {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'napcat' ? origin.conversation : undefined;
  const id = Number(conversation?.id);
  if (!conversation || (conversation.kind !== 'group' && conversation.kind !== 'private') || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error(t(context.locale, 'conversationRequired'));
  }
  context.signal?.throwIfAborted();
  return { type: conversation.kind, id };
}

/** The current private peer; model input cannot select another friend's history or chat. */
export function currentPrivatePeer(context: NapcatToolContext): number {
  const target = currentTarget(context);
  if (target.type !== 'private') throw new Error(t(context.locale, 'privateRequired'));
  return target.id;
}

/** OneBot message ids are account-wide: verify the message belongs to the current conversation. */
export async function requireMessageInConversation(context: NapcatToolContext, messageId: number): Promise<void> {
  const target = currentTarget(context);
  if (target.type === 'group') return requireMessageInGroup(context, target.id, messageId);
  const message = await context.$client.callApi('get_msg', { message_id: messageId }) as
    { message_type?: unknown; user_id?: unknown; target_id?: unknown; sender?: { user_id?: unknown } } | undefined;
  context.signal?.throwIfAborted();
  const peers = [message?.user_id, message?.target_id, message?.sender?.user_id].map(Number);
  if (message?.message_type !== 'private' || !peers.includes(target.id)) {
    throw new Error(t(context.locale, 'messageOutsideConversation'));
  }
}

/**
 * Deliver through the IM outbound chain (renderer → outbound middleware → Endpoint) to the current
 * conversation (CLAUDE.md Guardrail #1); tools never call the OneBot send actions themselves.
 */
export async function sendToCurrentConversation(context: NapcatToolContext, content: SendContent) {
  currentTarget(context);
  const conversation = context.origin.kind === 'im' ? context.origin.conversation : undefined;
  if (!conversation) throw new Error(t(context.locale, 'conversationRequired'));
  const receipt = await context.use(outboundMessageToken).send({ requester: context.owner.id, conversation, content });
  return { success: receipt.status === 'sent', ...(receipt.message?.id ? { message_id: receipt.message.id } : {}), receipt };
}
