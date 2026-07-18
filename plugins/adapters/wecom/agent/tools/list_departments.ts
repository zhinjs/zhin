import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getWecomAgentDeps } from '../../src/wecom-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; dept_id?: string }>({
  description: '获取企业微信部门列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    dept_id: z.string().optional().describe('父部门 ID，默认 1（根部门）'),
  }),
  platforms: ['wecom'],
  tags: ['wecom'],
  async execute({ endpoint_id, dept_id    }: { endpoint_id: string; dept_id?: string }) {
    const endpoint = getWecomAgentDeps().getEndpoint(endpoint_id);
    const departments = await endpoint.getDepartmentList(Number(dept_id) || 1);
    return { departments, count: departments.length };
  },
});

