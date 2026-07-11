import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getTelegramAgentDeps } from '../../src/telegram-agent-deps.js';

export default defineTool<{ endpoint_id: string; chat_id: string; can_send_messages?: boolean; can_send_photos?: boolean; can_send_videos?: boolean; can_send_polls?: boolean; can_send_other_messages?: boolean; can_add_web_page_previews?: boolean; can_change_info?: boolean; can_invite_users?: boolean; can_pin_messages?: boolean }>({
  description: '设置 Telegram 群组的默认成员权限',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    chat_id: z.string().describe('聊天 ID'),
    can_send_messages: z.boolean().optional().describe('是否可以发消息'),
    can_send_photos: z.boolean().optional().describe('是否可以发图片'),
    can_send_videos: z.boolean().optional().describe('是否可以发视频'),
    can_send_polls: z.boolean().optional().describe('是否可以发投票'),
    can_send_other_messages: z.boolean().optional().describe('是否可以发贴纸/GIF等'),
    can_add_web_page_previews: z.boolean().optional().describe('是否可以添加网页预览'),
    can_change_info: z.boolean().optional().describe('是否可以改群信息'),
    can_invite_users: z.boolean().optional().describe('是否可以邀请用户'),
    can_pin_messages: z.boolean().optional().describe('是否可以置顶消息'),
  }),
  platforms: ['telegram'],
  tags: ['telegram'],
  permissions: [platformPermit('manage_chat')],
  async execute({ endpoint_id, chat_id, ...perms  }: { endpoint_id: string; chat_id: string; can_send_messages?: boolean; can_send_photos?: boolean; can_send_videos?: boolean; can_send_polls?: boolean; can_send_other_messages?: boolean; can_add_web_page_previews?: boolean; can_change_info?: boolean; can_invite_users?: boolean; can_pin_messages?: boolean }) {
    const endpoint = getTelegramAgentDeps().getEndpoint(endpoint_id);
    const permissions: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(perms)) {
      if (typeof v === 'boolean') permissions[k] = v;
    }
    const success = await endpoint.setChatPermissionsAll(Number(chat_id), permissions);
    return { success, message: success ? '群权限已更新' : '操作失败' };
  },
});
