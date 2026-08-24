import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number; title: string }>({
  description: '设置 QQ 群成员的专属头衔。只有群主才能设置。',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
    title: z.string().describe('头衔文字'),
  }),
  adapter: 'onebot11',
  tags: ['onebot11'],
  permissions: ['platform(onebot11,scene_owner)'],
  async execute({ group_id, user_id, title }: { group_id: number; user_id: number; title: string }, context) {
    const client = context.$client;
    const response = await client.call('set_group_special_title', {
      group_id,
      user_id,
      special_title: title,
      duration: -1,
    });
    const success = response.status === 'ok';
    return { success, message: success ? `已将 ${user_id} 的头衔设为 "${title}"` : '设置失败' };
  },
});
