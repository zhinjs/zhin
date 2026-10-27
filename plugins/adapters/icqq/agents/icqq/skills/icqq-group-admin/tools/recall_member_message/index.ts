import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup, recallMessage, resolveMessage } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '撤回当前 QQ 群内他人的真实消息；需调用方具备群管发起权限及机器人具备实时平台权限，无需逐次审批',
  adapter: 'icqq',
  scopes: ['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'never',
  inputSchema: z.object({
    message_id: z.string().min(1).describe('当前群中要撤回的真实消息 ID'),
    reason: z.string().min(1).describe('撤回的具体原因，自动处理必须依据已确认的群规'),
  }),
  async execute({ message_id }, context) {
    const group = currentGroup(context);
    const message = await resolveMessage(context, message_id);
    const client = context.$client;
    // Own messages do not depend on membership administration rights.
    if (message.sender.user_id === client.uin) return recallMessage(context, message_id);
    const [self, target] = await Promise.all([
      client.getGroupMemberInfo(group, client.uin, true),
      client.getGroupMemberInfo(group, message.sender.user_id, true),
    ]);
    if (!(self.role === 'owner' && (target.role === 'admin' || target.role === 'member'))
      && !(self.role === 'admin' && target.role === 'member')) {
      return { success: false, message: t(context.locale, 'recallForbidden') };
    }
    return recallMessage(context, message_id);
  },
});
