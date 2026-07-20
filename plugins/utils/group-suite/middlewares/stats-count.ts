import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../src/config.js';
import { recordMessage } from '../src/stats-lib.js';
import { resolveGroupSuiteRuntime } from '../src/runtime-state.js';

/**
 * Buffer inbound messages into in-memory message_stats (flushed on query).
 * Skips command messages (legacy used `isActionMessage` to skip interactive
 * action/command messages; the Runtime pipeline represents commands as
 * text starting with the dispatcher prefix '/').
 */
export default defineMiddleware<Message, GroupSuiteConfig>({
  target: 'inbound',
  async handle(context, next) {
    const content = typeof context.input.content === 'string' ? context.input.content : '';
    if (!content.startsWith('/')) {
      recordMessage(context.input, resolveGroupSuiteRuntime(context));
    }
    await next();
  },
});
