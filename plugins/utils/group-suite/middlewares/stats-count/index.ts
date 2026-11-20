import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { hintWelcomePrefix } from '../../src/welcome-template.js';
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
    // #1250: the first group message of an account carries its real command prefix; no public API
    // gives it earlier, so the welcome-text check runs here once per account and text.
    const prefix = context.input.commandPrefix;
    if (prefix && context.input.conversation.kind === 'group') {
      const { welcomeMessage } = groupSuiteConfigFor(context, context.input);
      hintWelcomePrefix(context.input.conversation.endpoint.id, welcomeMessage, prefix);
    }
    await next();
  },
});
