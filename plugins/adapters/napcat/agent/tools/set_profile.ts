import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; nickname: string; company?: string; email?: string; college?: string; personal_note?: string }>({
  description: '修改 QQ 资料（昵称等）。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    nickname: z.string().describe('昵称'),
    company: z.string().optional().describe('公司（可选）'),
    email: z.string().optional().describe('邮箱（可选）'),
    college: z.string().optional().describe('学校（可选）'),
    personal_note: z.string().optional().describe('个人说明（可选）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['修改资料', '设置昵称', 'profile', 'set profile'],
  async execute({ endpoint_id, nickname, company, email, college, personal_note }: { endpoint_id: string; nickname: string; company?: string; email?: string; college?: string; personal_note?: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.setQQProfile(nickname, company, email, college, personal_note);
      return { success: true };
  },
});
