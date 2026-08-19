import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number }>({
  description: '获取 QQ 群的群文件列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
  }),
  platforms: ['icqq'],
  approval: 'never',
  async execute({ endpoint_id, group_id }: { endpoint_id: string; group_id: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const files = await endpoint.acquireGfs(group_id).ls('/');
    if (!files.length) return { files: [], message: '群文件为空' };
    return {
      files: files.slice(0, 30).map((f) => 'size' in f
        ? { name: f.name, is_dir: false, size: f.size, uploader: f.user_id, upload_time: f.create_time }
        : { name: f.name, is_dir: true, file_count: f.file_count }),
      count: files.length,
    };
  },
});
