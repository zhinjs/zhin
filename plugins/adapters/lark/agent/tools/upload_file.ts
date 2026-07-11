import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLarkAgentDeps } from '../../src/lark-agent-deps.js';
export default defineTool<{ endpoint_id: string; file_path: string }>({
  description: '上传文件到飞书（opus/mp4/pdf/doc/xls/ppt/stream）',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    file_path: z.string().describe('本地文件路径'),
    file_type: z.enum(['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream']).describe('文件类型'),
  }),
  platforms: ['lark'],
  tags: ['lark'],
  async execute({ endpoint_id, file_path, file_type   }: { endpoint_id: string; file_path: string }) {
    const endpoint = getLarkAgentDeps().getEndpoint(endpoint_id);
    const result = await endpoint.uploadFile(file_path, file_type);
    return { success: true, file_key: result, message: `文件已上传，file_key: ${result}` };
  },
});

