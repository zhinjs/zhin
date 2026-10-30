import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentConversation, recallTarget, requireGroupManager, resolveMessageTarget } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '撤回当前 QQ 群或频道子频道内他人的真实消息；需调用方具备群管发起权限，机器人须为管理员，官方只允许 2 分钟内',
  adapter: 'qq',
  scopes: ['group', 'channel'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'never',
  inputSchema: z.object({
    message_id: z.string().min(1).describe('当前会话中要撤回的真实消息 ID，或消息头里的 m<n> 别名'),
    reason: z.string().min(1).describe('撤回的具体原因，自动处理必须依据已确认的群规'),
  }),
  async execute({ message_id }, context) {
    const conversation = currentConversation(context);
    const target = resolveMessageTarget(context, message_id);
    // 自己的消息不依赖管理员身份。群里再实时核验机器人角色；目标角色（只能撤回普通成员）由平台执行。
    if (!target.ownOutbound && conversation.kind === 'group' && !await requireGroupManager(context, conversation.id)) {
      return { success: false, message: t(context.locale, 'botNotManager') };
    }
    return recallTarget(context, target);
  },
});
