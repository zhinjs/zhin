import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number }>({
  description: '获取 QQ 群的群文件列表',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
  }),
  adapter: 'icqq',
  approval: 'never',
  async execute({ group_id }, context) {
    const files = await context.$client.acquireGfs(group_id).ls('/');
    if (!files.length) return { files: [], message: '群文件为空' };
    return {
      files: files.slice(0, 30).map((f) => 'size' in f
        ? { name: f.name, is_dir: false, size: f.size, uploader: f.user_id, upload_time: f.create_time }
        : { name: f.name, is_dir: true, file_count: f.file_count }),
      count: files.length,
    };
  },
});
