import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { tryTeachReply } from '../src/teach-lib.js';

/**
 * Teach Q&A auto-reply (exact / optional regex).
 * Uses Runtime Message.content / metadata.
 */
export default defineMiddleware<Message, GroupSuiteConfig>({
  target: 'inbound',
  async handle(context, next) {
    const config = resolveGroupSuiteConfig(context.config);
    const reply = await tryTeachReply(context.input, config);
    if (reply) {
      await context.input.$reply(reply);
      return;
    }
    await next();
  },
});
