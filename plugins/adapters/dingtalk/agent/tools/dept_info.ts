import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getDingtalkAgentDeps } from '../../src/dingtalk-agent-deps.js';
export default defineTool<{ endpoint_id: string; dept_id: string }>({
  description: '获取钉钉部门详细信息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    dept_id: z.string().describe('部门 ID'),
  }),
  platforms: ['dingtalk'],
  tags: ['dingtalk'],
  async execute({ endpoint_id, dept_id    }: { endpoint_id: string; dept_id: string }) {
    const endpoint = getDingtalkAgentDeps().getEndpoint(endpoint_id);
    return await endpoint.getDepartmentInfo(Number(dept_id));
  },
});

