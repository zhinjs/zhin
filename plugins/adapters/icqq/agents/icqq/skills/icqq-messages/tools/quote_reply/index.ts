import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { resolveMessage, sendToConversation } from '../../../../conversation.js';

export default defineAgentTool({
  description: '引用当前 QQ 群或私聊中的真实消息并回复文字；无需群管角色，发送走统一链路',
  adapter: 'icqq',
  scopes: ['private', 'group'],
  requiresApproval: 'never',
  inputSchema: z.object({
    message_id: z.string().min(1).describe('当前会话中真实的原消息 ID'),
    text: z.string().min(1).describe('本次回复的文字'),
  }),
  async execute({ message_id, text }, context) {
    const original = await resolveMessage(context, message_id);
    return sendToConversation(context, [
      { type: 'reply', data: { message_id }, platform: { icqqQuote: {
        user_id: original.sender.user_id, seq: original.seq, rand: original.rand,
        time: original.time, message: original.raw_message,
      } } },
      { type: 'text', data: { text } },
    ]);
  },
});
