import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
export default defineAgentTool<{ dept_id: string }>({
  description: '获取钉钉部门用户列表',
  inputSchema: z.object({
    dept_id: z.string().describe('部门 ID'),
  }),
  adapter: 'dingtalk',
  tags: ['dingtalk'],
  async execute({ dept_id    }: { dept_id: string }, context) {
    const endpoint = context.$client;
    const users = await endpoint.getDepartmentUsers(Number(dept_id));
    return { users, count: users.length };
  },
});

