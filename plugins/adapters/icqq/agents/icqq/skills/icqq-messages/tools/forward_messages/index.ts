import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentConversation, resolveMessage, sendToConversation } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '将当前 QQ 群或私聊中的真实消息合并转发到本会话；保留真实作者和内容，不支持跨会话转发',
  adapter: 'icqq',
  scopes: ['private', 'group'],
  requiresApproval: 'never',
  inputSchema: z.object({ message_ids: z.array(z.string().min(1)).min(1).describe('当前会话的真实消息 ID（或消息头里的 m<n> 别名），按转发顺序排列') }),
  async execute({ message_ids }, context) {
    const conversation = currentConversation(context);
    if (conversation.kind === 'channel') throw new Error(t(context.locale, 'channelOperationUnsupported'));
    const originals = [];
    for (const id of message_ids) originals.push(await resolveMessage(context, id));
    const client = context.$client;
    const target = conversation.kind === 'group' ? client.pickGroup(Number(conversation.id))
      : conversation.parent?.kind === 'group' ? client.pickMember(Number(conversation.parent.id), Number(conversation.id))
        : client.pickFriend(Number(conversation.id));
    // SDK preparation uploads a resource; only the gateway below delivers a message.
    const card = await target.makeForwardMsg(originals.map(message => ({
      user_id: message.sender.user_id,
      nickname: message.sender.nickname,
      time: message.time,
      message: message.message,
    })));
    context.signal.throwIfAborted();
    const data = typeof card.data === 'string' ? JSON.parse(card.data) : card.data;
    const detail = data?.meta?.detail;
    if (typeof detail?.resid !== 'string' || !detail.resid || typeof detail.uniseq !== 'string' || !detail.uniseq) {
      throw new Error('ICQQ did not return a complete merged-forward resource');
    }
    return sendToConversation(context, {
      type: 'forward',
      data: { forward_id: detail.resid },
      platform: { icqqForwardFilename: detail.uniseq },
    });
  },
});
