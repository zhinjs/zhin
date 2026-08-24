import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ nickname: string; company?: string; email?: string; college?: string; personal_note?: string }>({
  description: '修改 QQ 资料（昵称等）。',
  inputSchema: z.object({
    nickname: z.string().describe('昵称'),
    company: z.string().optional().describe('公司（可选）'),
    email: z.string().optional().describe('邮箱（可选）'),
    college: z.string().optional().describe('学校（可选）'),
    personal_note: z.string().optional().describe('个人说明（可选）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['修改资料', '设置昵称', 'profile', 'set profile'],
  async execute({ nickname, company, email, college, personal_note }: { nickname: string; company?: string; email?: string; college?: string; personal_note?: string }, context) {
    const endpoint = context.$client;
      await endpoint.setQQProfile(nickname, company, email, college, personal_note);
      return { success: true };
  },
});
