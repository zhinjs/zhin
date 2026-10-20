import { defineCommand } from 'zhin.js/command';
import { BiliApiError, parseRoomId } from '../../../src/api.js';
import type { BilibiliConfig } from '../../../src/config.js';
import { formatRoom } from '../../../src/format.js';
import { bilibiliRuntimeToken } from '../../../src/runtime.js';

export default defineCommand<BilibiliConfig>({
  description: '查询 B 站直播间状态',
  params: { room: { type: 'string', description: '直播间号或直播间链接' } },
  async execute({ params, use }) {
    const roomId = parseRoomId(String(params.room ?? ''));
    if (!roomId) return '请提供直播间号或链接，格式：bili live <房间号>';
    const { client } = use(bilibiliRuntimeToken);
    try {
      const room = await client.getRoomInfo(roomId);
      let uname = '';
      let liveTime = 0;
      if (room.uid) {
        const info = (await client.getLiveStatus([room.uid]).catch(() => new Map())).get(room.uid);
        uname = info?.uname ?? '';
        liveTime = info?.liveTime ?? 0;
      }
      return formatRoom(room, uname, liveTime);
    } catch (error) {
      if (error instanceof BiliApiError && error.kind === 'not_found') return `直播间 ${roomId} 不存在`;
      return `查询失败：${(error as Error).message}`;
    }
  },
});
