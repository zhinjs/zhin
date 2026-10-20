import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../src/config.js';
import { recordMessage } from '../../src/stats-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

/** Count in memory; the admitted Schedule Host flushes batches without slowing every message. */
export default defineMiddleware<Message, GroupSuiteConfig>({
  target: 'inbound',
  async handle(context, next) {
    const content = typeof context.input.content === 'string' ? context.input.content : '';
    if (!content.startsWith('/')) {
      const runtime = resolveGroupSuiteRuntime(context);
      recordMessage(context.input, runtime);
    }
    await next();
  },
});
