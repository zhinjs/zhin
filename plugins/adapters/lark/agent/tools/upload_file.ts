import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLarkAgentDeps } from '../../src/lark-agent-deps.js';

export default defineAgentTool<{
  endpoint_id: string;
  file_path: string;
  file_type: 'image' | 'file' | 'video' | 'audio';
}>({
  description: '上传文件到飞书（image/file/video/audio）',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    file_path: z.string().describe('本地文件路径'),
    file_type: z.enum(['image', 'file', 'video', 'audio']).default('file').describe('飞书文件类型'),
  }),
  platforms: ['lark'],
  tags: ['lark'],
  async execute({ endpoint_id, file_path, file_type }: {
    endpoint_id: string;
    file_path: string;
    file_type: 'image' | 'file' | 'video' | 'audio';
  }) {
    const endpoint = getLarkAgentDeps().getEndpoint(endpoint_id);
    const result = await endpoint.uploadFile(file_path, file_type);
    return { success: true, file_key: result, message: `文件已上传，file_key: ${result}` };
  },
});
