import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { parseRoomId, parseUid } from '../../../../src/api.js';
import { formatRoom, liveStatusText } from '../../../../src/format.js';
import { bilibiliRuntimeToken } from '../../../../src/runtime.js';

export default defineAgentTool({
  description: '查询 B 站直播间或 UP 主当前是否在直播',
  requiresApproval: 'never',
  tags: ['bilibili'],
  keywords: ['b站', '直播', '开播', 'bilibili live'],
  inputSchema: z.object({
    room: z.string().optional().describe('直播间号或直播间链接'),
    uid: z.string().optional().describe('UP 主 UID 或空间链接'),
  }),
  async execute({ room, uid }, context) {
    const { client } = context.use(bilibiliRuntimeToken);
    try {
      const roomId = room ? parseRoomId(room) : undefined;
      if (roomId) {
        const info = await client.getRoomInfo(roomId);
        const live = info.uid ? (await client.getLiveStatus([info.uid])).get(info.uid) : undefined;
        return formatRoom(info, live?.uname ?? '', live?.liveTime ?? 0);
      }
      const upUid = uid ? parseUid(uid) : undefined;
      if (!upUid) return '请提供直播间号（room）或 UP 主 UID（uid）';
      const live = (await client.getLiveStatus([upUid])).get(upUid);
      if (!live) return `UID ${upUid} 没有开通直播间`;
      return [`${live.uname || upUid}：${liveStatusText(live.liveStatus)}`, live.title && `标题：${live.title}`, live.url]
        .filter(Boolean)
        .join('\n');
    } catch (error) {
      return `查询失败：${(error as Error).message}`;
    }
  },
});
