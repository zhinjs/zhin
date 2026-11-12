import { messages as t } from "../../../../messages.js";
import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<Record<string, never>>({
  description: '获取当前 QQ 群的群文件列表',
  inputSchema: z.object({}),
  adapter: 'icqq',
  requiresApproval: 'once',
  scopes:['group'],
  permissions: ['trusted'],
  async execute(_input, context) {
    const files = await context.$client.acquireGfs(currentGroup(context)).ls('/');
    if (!files.length) return { files: [], message: t(context.locale, 'filesEmpty') };
    return {
      files: files.slice(0, 30).map((f) => 'size' in f
        ? { name: f.name, is_dir: false, size: f.size, uploader: f.user_id, upload_time: f.create_time }
        : { name: f.name, is_dir: true, file_count: f.file_count }),
      count: files.length,
    };
  },
});
