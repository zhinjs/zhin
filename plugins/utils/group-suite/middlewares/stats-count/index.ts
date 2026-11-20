import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { hintLegacyPlaceholders, hintWelcomePrefix } from '../../src/welcome-template.js';
import { groupSuiteSendsWelcome } from '../../src/welcome-scope.js';
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
    // gives it earlier, so the welcome-text checks run here once per account and text — only for a
    // group this plugin actually welcomes (in welcomeConversations, not taken over by the Agent).
    const conversation = context.input.conversation;
    if (conversation.kind === 'group') {
      const { welcomeMessage, welcomeConversations } = groupSuiteConfigFor(context, context.input);
      if (welcomeMessage && groupSuiteSendsWelcome(context, welcomeConversations, conversation)) {
        hintLegacyPlaceholders('welcomeMessage', conversation.endpoint.id, welcomeMessage);
        hintWelcomePrefix(conversation.endpoint.id, welcomeMessage, context.input.commandPrefix);
      }
    }
    await next();
  },
});
