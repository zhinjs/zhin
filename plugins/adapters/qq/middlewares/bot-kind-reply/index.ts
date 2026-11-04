import { messages as t } from '../../src/i18n.js';
import { defineMiddleware } from 'zhin.js/middleware';
import type { CommandMessage } from 'zhin.js/command';
import {
  completeQqPendingBotKind,
} from '../../commands/qq/endpoint/definition.js';
import {
  parseQqBotKindAnswer,
  qqCommandSessionKey,
  qqBotKindPrompt,
} from '../../src/qq-bot-kind-prompt.js';
import { qqRuntimeStateToken } from '../../src/qq-runtime-state.js';

/**
 * 扫码绑定成功后，在同一会话收取 public/private（或 公域/私域）回复并写入 intents。
 * 非待确认会话、或内容无法识别为 botKind 时放行后续中间件/命令。
 */
export default defineMiddleware<CommandMessage>({
  target: 'inbound',
  phase: 'before-dispatch',
  order: -50,
  async handle(context, next) {
    const state = context.use(qqRuntimeStateToken);
    const pending = state.pendingBotKind;
    if (!pending) {
      await next();
      return;
    }

    const sessionKey = qqCommandSessionKey(context.input);
    if (!sessionKey || sessionKey !== pending.sessionKey) {
      await next();
      return;
    }

    const raw = String(context.input.content ?? '').trim();
    // 让 qq endpoint cancel 等命令继续走命令链
    if ([...(pending.commandHeads ?? []), ...(pending.cancelCommand ? [pending.cancelCommand] : [])].some(head => raw.toLowerCase() === head.toLowerCase() || raw.toLowerCase().startsWith(`${head.toLowerCase()} `))) {
      await next();
      return;
    }

    const botKind = parseQqBotKindAnswer(raw, pending.locale);
    if (!botKind) {
      await context.input.$reply?.(
        t(pending.locale, 'kindUnrecognized', { raw, prompt: qqBotKindPrompt(pending.locale, pending.cancelCommand) }),
      );
      return;
    }

    try {
      const text = await completeQqPendingBotKind(
        pending,
        botKind,
      );
      state.pendingBotKind = null;
      await context.input.$reply?.(text);
    } catch (error) {
      await context.input.$reply?.(
        t(pending.locale, 'configFailed', { error: error instanceof Error ? error.message : String(error) }),
      );
    }
  },
});
