import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { recallTarget, resolveMessageTarget } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '撤回机器人在当前 QQ 会话中自己发送的消息；无需群管角色或逐次审批，官方只允许撤回 2 分钟内的消息',
  adapter: 'qq',
  scopes: ['private', 'group', 'channel'],
  requiresApproval: 'never',
  inputSchema: z.object({ message_id: z.string().min(1).describe('机器人在当前会话中发送的消息 ID（发送回执），或消息头里的 m<n> 别名') }),
  async execute({ message_id }, context) {
    const target = resolveMessageTarget(context, message_id);
    if (!target.ownOutbound) return { success: false, message: t(context.locale, 'ownMessageRequired') };
    return recallTarget(context, target);
  },
});
