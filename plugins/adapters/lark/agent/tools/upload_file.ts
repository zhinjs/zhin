import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{
  file_path: string;
  file_type: 'image' | 'file' | 'video' | 'audio';
}>({
  description: '上传文件到飞书（image/file/video/audio）',
  inputSchema: z.object({
    file_path: z.string().describe('本地文件路径'),
    file_type: z.enum(['image', 'file', 'video', 'audio']).default('file').describe('飞书文件类型'),
  }),
  adapter: 'lark',
  tags: ['lark'],
  async execute({ file_path, file_type }: {
    file_path: string;
    file_type: 'image' | 'file' | 'video' | 'audio';
  }, context) {
    const endpoint = context.$client;
    const result = await endpoint.uploadFile(file_path, file_type);
    return { success: true, file_key: result, message: `文件已上传，file_key: ${result}` };
  },
});
