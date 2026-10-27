import { parseDmMessageId, parseGroupMessageId, type GroupMessage, type PrivateMessage } from '@icqqjs/icqq';
import { outboundMessageToken, type SendContent } from '@zhin.js/core/runtime';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type IcqqToolContext = ToolExecutionContext<unknown, 'icqq'>;

/** The trusted turn owns the account and address; model input cannot select another one. */
export function currentConversation(context: IcqqToolContext) {
  const { origin } = context;
  if (origin.kind !== 'im' || origin.platform !== 'icqq' || !origin.conversation) {
    throw new Error(t(context.locale, 'conversationRequired'));
  }
  context.signal.throwIfAborted();
  return origin.conversation;
}

export function currentGroup(context: IcqqToolContext) {
  const conversation = currentConversation(context);
  if (conversation.kind !== 'group') throw new Error(t(context.locale, 'groupRequired'));
  return Number(conversation.id);
}

/** getMsg returns the last history item, which is not necessarily the requested message. */
export async function resolveMessage(context: IcqqToolContext, id: string): Promise<GroupMessage | PrivateMessage> {
  const conversation = currentConversation(context);
  const invalid = () => new Error(t(context.locale, 'messageOutsideConversation'));
  if (conversation.kind === 'channel') throw new Error(t(context.locale, 'channelOperationUnsupported'));
  // Check the encoded destination before requesting any history from the platform.
  try {
    const address = id.length > 24 ? parseGroupMessageId(id) : parseDmMessageId(id);
    if (conversation.kind === 'group'
      ? !('group_id' in address) || String(address.group_id) !== conversation.id
      : 'group_id' in address || String(address.user_id) !== conversation.id) throw invalid();
  } catch { throw invalid(); }
  const message = await context.$client.getMsg(id);
  context.signal.throwIfAborted();
  if (!message || message.message_id !== id) throw invalid();
  if (conversation.kind === 'group') {
    if (message.message_type !== 'group' || String(message.group_id) !== conversation.id) throw invalid();
  } else {
    if (message.message_type !== 'private') throw invalid();
    const self = context.$client.uin;
    const peer = Number(conversation.id);
    if (!((message.from_id === self && message.to_id === peer)
      || (message.from_id === peer && message.to_id === self))) throw invalid();
    const parent = conversation.parent?.kind === 'group' ? Number(conversation.parent.id) : undefined;
    if (message.sender.group_id !== parent) throw invalid();
  }
  return message;
}

export async function sendToConversation(context: IcqqToolContext, content: SendContent) {
  const conversation = currentConversation(context);
  const receipt = await context.use(outboundMessageToken).send({
    requester: context.owner.id,
    conversation,
    content,
  });
  return { success: receipt.status === 'sent', receipt };
}

export async function recallMessage(context: IcqqToolContext, id: string) {
  context.signal.throwIfAborted();
  const success = await context.$client.deleteMsg(id);
  return { success, message: t(context.locale, success ? 'messageRecalled' : 'recallUnconfirmed') };
}
