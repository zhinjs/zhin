import { messages as t } from "../../../../messages.js";
import { currentTarget } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ user_id?: number }>({
  description: '在当前会话戳一戳：群聊中戳 user_id 指定的成员，私聊中戳对方。',
  inputSchema: z.object({
    user_id: z.number().optional().describe('群聊中要戳的成员 QQ 号（私聊中忽略，固定为对方）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['戳一戳', 'poke', '戳', '拍一拍'],
  async execute({ user_id }, context) {
    const target = currentTarget(context);
    const userId = target.type === 'group' ? user_id : target.id;
    if (userId === undefined) return { success: false, message: t(context.locale, 'pokeTargetRequired') };
    await context.$client.sendPoke(userId, target.type === 'group' ? target.id : undefined);
    return { success: true, message: t(context.locale, 'userPoked', { p0: userId }) };
  },
});
