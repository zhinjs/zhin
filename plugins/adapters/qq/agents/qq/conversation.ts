import { outboundMessageToken, type SendContent } from '@zhin.js/core/runtime';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { parseCompoundMessageId, qqOutboundKind, type QqChannelKind } from '../../src/protocol.js';
// Shared with EndpointManagement so Console, auto-moderation and Agent tools enforce the same official limits.
export { kickQqGroupMember, muteQqGroupMember, QQ_GROUP_MUTE_MAX_SECONDS } from '../../src/group-admin.js';
import { messages as t } from './messages.js';

export type QqToolContext = ToolExecutionContext<unknown, 'qq'>;

/** The trusted turn owns the endpoint and address; model input cannot select another one. */
export function currentConversation(context: QqToolContext) {
  const { origin } = context;
  if (origin.kind !== 'im' || origin.platform !== 'qq' || !origin.conversation) {
    throw new Error(t(context.locale, 'conversationRequired'));
  }
  context.signal.throwIfAborted();
  return origin.conversation;
}

/** Current QQ group_openid. */
export function currentGroup(context: QqToolContext): string {
  const conversation = currentConversation(context);
  if (conversation.kind !== 'group') throw new Error(t(context.locale, 'groupRequired'));
  return conversation.id;
}

/** Current guild child channel and its guild. */
export function currentGuildChannel(context: QqToolContext): { guildId: string; channelId: string } {
  const conversation = currentConversation(context);
  const guildId = conversation.parent?.kind === 'channel' ? conversation.parent.id : '';
  if (conversation.kind !== 'channel' || !guildId) throw new Error(t(context.locale, 'channelRequired'));
  return { guildId, channelId: conversation.id };
}

export interface QqMessageTarget {
  readonly kind: QqChannelKind;
  readonly targetId: string;
  readonly messageId: string;
  /** `send()` receipt IDs are compound; only those are known to be the bot's own messages. */
  readonly ownOutbound: boolean;
}

/**
 * Resolve a message ID inside the current conversation. Outbound receipts are `kind-target:msgId`
 * and must match the current conversation; anything else is a native inbound ID of this conversation.
 */
export function resolveMessageTarget(context: QqToolContext, id: string): QqMessageTarget {
  const conversation = currentConversation(context);
  const kind = qqOutboundKind(conversation);
  const value = id.trim();
  if (!value) throw new Error(t(context.locale, 'messageOutsideConversation'));
  let compound: ReturnType<typeof parseCompoundMessageId> | undefined;
  try { compound = parseCompoundMessageId(value); } catch { compound = undefined; }
  if (compound) {
    if (compound.kind !== kind || compound.channelId !== conversation.id || !compound.qqMsgId) {
      throw new Error(t(context.locale, 'messageOutsideConversation'));
    }
    return { kind, targetId: conversation.id, messageId: compound.qqMsgId, ownOutbound: true };
  }
  return { kind, targetId: conversation.id, messageId: value, ownOutbound: false };
}

export async function recallTarget(context: QqToolContext, target: QqMessageTarget) {
  context.signal.throwIfAborted();
  const client = context.$client;
  const recall = {
    private: client.recallPrivateMessage, group: client.recallGroupMessage,
    channel: client.recallGuildMessage, direct: client.recallDirectMessage,
  }[target.kind];
  if (!recall) return { success: false, message: t(context.locale, 'recallUnconfirmed') };
  try {
    const result = await recall.call(client, target.targetId, target.messageId);
    const success = result !== false;
    return { success, message: t(context.locale, success ? 'messageRecalled' : 'recallUnconfirmed') };
  } catch (error) {
    return {
      success: false,
      message: t(context.locale, 'recallUnconfirmed'),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendToConversation(context: QqToolContext, content: SendContent) {
  const conversation = currentConversation(context);
  const receipt = await context.use(outboundMessageToken).send({
    requester: context.owner.id,
    conversation,
    content,
  });
  return { success: receipt.status === 'sent', receipt };
}

/** Live check: the bot must be owner/admin of the current group. */
export async function requireGroupManager(context: QqToolContext, groupId: string) {
  const state = await context.$client.api.groupService.getBotState(groupId);
  context.signal.throwIfAborted();
  return state.member_role === 'owner' || state.member_role === 'admin' ? state : undefined;
}
