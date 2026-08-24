import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
export default defineAgentTool<{ dept_id?: string }>({
  description: '获取钉钉部门列表',
  inputSchema: z.object({
    dept_id: z.string().optional().describe('父部门 ID，默认 1（根部门）'),
  }),
  adapter: 'dingtalk',
  tags: ['dingtalk'],
  async execute({ dept_id    }: { dept_id?: string }, context) {
    const endpoint = context.$client;
    const departments = await endpoint.getDepartmentList(Number(dept_id || '1'));
    return { departments, count: departments.length };
  },
});

