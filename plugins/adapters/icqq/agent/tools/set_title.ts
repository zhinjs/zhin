import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; user_id: number; title: string; duration?: number }>({
  description: '设置 QQ 群成员的专属头衔',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
    title: z.string().describe('头衔文字'),
    duration: z.number().optional().describe('持续时间(秒)，-1永久'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  permissions: ['platform(icqq,scene_owner)'],
  async execute({ endpoint_id, group_id, user_id, title, duration    }: { endpoint_id: string; group_id: number; user_id: number; title: string; duration?: number }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const resp = await endpoint.ipc.request(Actions.SET_GROUP_TITLE, {
      group_id, user_id, title, duration: duration ?? -1,
    });
    return { success: resp.ok, message: resp.ok ? `已将 ${user_id} 的头衔设为 "${title}"` : (resp.error ?? '设置失败') };
  },
});

