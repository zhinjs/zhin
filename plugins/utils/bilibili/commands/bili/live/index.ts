import { messages, commandHint } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { BiliApiError, parseRoomId } from '../../../src/api.js';
import type { BilibiliConfig } from '../../../src/config.js';
import { formatRoom } from '../../../src/format.js';
import { bilibiliRuntimeToken } from '../../../src/runtime.js';

export default defineCommand<BilibiliConfig>({
  description: '查询 B 站直播间状态', descriptionI18n: { en: "Look up a Bilibili live room" },
  params: { room: { type: 'string', description: '直播间号或直播间链接', descriptionI18n: { en: "Live room ID or URL" } } },
  async execute({ locale, formatCommand, params, use }) {
    const roomId = parseRoomId(String(params.room ?? ''));
    if (!roomId) return messages(locale, 'room') + commandHint(locale, formatCommand('bili live'), '<room>');
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
      return formatRoom(room, uname, liveTime, Date.now(), locale);
    } catch (error) {
      if (error instanceof BiliApiError && error.kind === 'not_found') return messages(locale, 'missingRoom', { room: roomId });
      return messages(locale, 'failed', { error: (error as Error).message });
    }
  },
});
