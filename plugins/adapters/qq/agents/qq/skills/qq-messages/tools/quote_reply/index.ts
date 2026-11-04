import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { resolveMessageTarget, sendToConversation } from '../../../../conversation.js';

export default defineAgentTool({
  description: '引用当前 QQ 会话中的真实消息并回复文字（引用即被动回复的 msg_id / message_reference）；发送走统一链路',
  adapter: 'qq',
  scopes: ['private', 'group', 'channel'],
  requiresApproval: 'never',
  inputSchema: z.object({
    message_id: z.string().min(1).describe('当前会话中真实的原消息 ID，或消息头里的 m<n> 别名'),
    text: z.string().min(1).describe('本次回复的文字'),
  }),
  async execute({ message_id, text }, context) {
    const target = resolveMessageTarget(context, message_id);
    return sendToConversation(context, [
      { type: 'reply', data: { message_id: target.messageId } },
      { type: 'text', data: { text } },
    ]);
  },
});
