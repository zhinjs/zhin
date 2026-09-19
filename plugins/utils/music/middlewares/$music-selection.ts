import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { sessionKey, resolveMessageIds, getPending, clearPending } from '../src/session.js';
import { shareMusicDetail, buildMusicShareSegment } from '../src/music-lib.js';
import { SOURCE_DISPLAY_NAME } from '../src/config.js';

export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const raw = context.input.content?.trim() ?? '';
    if (!raw) {
      await next();
      return;
    }

    const ids = resolveMessageIds(context.input);
    if (!ids) {
      await next();
      return;
    }

    const key = sessionKey(ids.endpointId, ids.conversationId, ids.senderId);
    const pending = getPending(key);
    if (!pending) {
      await next();
      return;
    }

    if (raw === '取消') {
      clearPending(key);
      await context.input.$reply('已取消点歌');
      return;
    }

    const num = parseInt(raw, 10);
    if (isNaN(num) || num < 1 || num > pending.results.length) {
      await next();
      return;
    }

    clearPending(key);
    const selected = pending.results[num - 1]!;
    const sourceName = SOURCE_DISPLAY_NAME[selected.source] ?? selected.source;

    const detailResult = await shareMusicDetail(selected.id, selected.source);
    if (!detailResult.success) {
      await context.input.$reply(
        `[${sourceName}] 获取"${selected.title}"播放信息失败：${detailResult.error}`,
      );
      return;
    }

    const segment = buildMusicShareSegment(detailResult.music);
    await context.input.$reply(segment);
  },
});
