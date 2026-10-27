import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { recallMessage, resolveMessage } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '撤回机器人在当前 QQ 群或私聊中自己的发言；无需群管角色或逐次审批，时限由平台决定',
  adapter: 'icqq',
  scopes: ['private', 'group'],
  requiresApproval: 'never',
  inputSchema: z.object({ message_id: z.string().min(1).describe('机器人在当前会话中发送的真实消息 ID') }),
  async execute({ message_id }, context) {
    const message = await resolveMessage(context, message_id);
    if (message.sender.user_id !== context.$client.uin) return { success: false, message: t(context.locale, 'ownMessageRequired') };
    return recallMessage(context, message_id);
  },
});
