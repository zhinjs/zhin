import { currentGuild } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前 KOOK 服务器的角色列表（position 越小优先级越高）',
  inputSchema: z.object({}),
  adapter: 'kook',
  scopes: ["channel"],
  tags: ['kook'],
  async execute(_args, context) {
    const roles = await context.$client.pickGuild(currentGuild(context)).getRoleList();
    return {
      roles: roles.map((r) => ({
        id: String(r.role_id),
        name: r.name,
        color: r.color,
        position: r.position,
        permissions: r.permissions,
      })),
      count: roles.length,
    };
  },
});
