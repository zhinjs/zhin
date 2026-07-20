import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { matchKeyword } from '../src/keyword-store.js';

/**
 * Keyword auto-reply (enabled via config.keywordReply).
 * Uses Runtime Message.content / metadata (legacy used $raw / $channel).
 */
export default defineMiddleware<Message, GroupSuiteConfig>({
  target: 'inbound',
  async handle(context, next) {
    const config = resolveGroupSuiteConfig(context.config);
    if (!config.keywordReply) {
      await next();
      return;
    }
    const meta = context.input.metadata ?? {};
    const channelType = String(meta.type ?? meta.channelType ?? '');
    if (channelType === 'private') {
      await next();
      return;
    }
    const text = typeof context.input.content === 'string' ? context.input.content.trim() : '';
    if (!text) {
      await next();
      return;
    }
    const reply = matchKeyword(text);
    if (reply) {
      await context.input.$reply(reply);
      return;
    }
    await next();
  },
});
