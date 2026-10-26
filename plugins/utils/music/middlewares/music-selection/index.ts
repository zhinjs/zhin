import { resolveLocale } from 'zhin.js/i18n';
import { messages as t, sourceName as displayName } from '../../src/i18n.js';
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { sessionKey, resolveMessageIds } from '../../src/session.js';
import { shareMusicDetail, buildMusicShareSegment } from '../../src/music-lib.js';
import { musicRuntimeToken } from '../../src/runtime.js';

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

    const key = sessionKey(ids.conversation, ids.senderId);
    const runtime = context.use(musicRuntimeToken);
    const pending = runtime.sessions.get(key);
    if (!pending) {
      await next();
      return;
    }

    const locale = resolveLocale(pending.locale);
    if (raw === (locale === 'en' ? 'cancel' : '取消')) {
      runtime.sessions.delete(key);
      await context.input.$reply(t(locale, 'cancelSelection'));
      return;
    }

    const num = parseInt(raw, 10);
    if (isNaN(num) || num < 1 || num > pending.results.length) {
      await next();
      return;
    }

    runtime.sessions.delete(key);
    const selected = pending.results[num - 1]!;
    const sourceName = displayName(selected.source, locale) ?? selected.source;

    const detailResult = await shareMusicDetail(
      runtime,
      selected.id,
      selected.source,
      locale,
    );
    if (!detailResult.success) {
      await context.input.$reply(
        t(locale, 'detailFailed', { source: sourceName, title: selected.title, error: detailResult.error }),
      );
      return;
    }

    const segment = buildMusicShareSegment(detailResult.music);
    await context.input.$reply(segment);
  },
});
