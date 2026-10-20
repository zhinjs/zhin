import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../../src/config.js';
import { matchKeyword } from '../../src/keyword-store.js';
import { keywords } from '../../src/keywords.js';

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
    if (context.input.conversation.kind !== 'group') {
      await next();
      return;
    }
    const text = typeof context.input.content === 'string' ? context.input.content.trim() : '';
    if (!text) {
      await next();
      return;
    }
    const reply = matchKeyword(text, new Map(await keywords(context.input, context).read()));
    if (reply) {
      await context.input.$reply(reply);
      return;
    }
    await next();
  },
});
