import { defineMiddleware } from '@zhin.js/middleware';
import type { CommandMessage } from '@zhin.js/command';
import {
  completeQqPendingBotKind,
} from '../src/qq-endpoint-commands.js';
import {
  parseQqBotKindAnswer,
  qqCommandSessionKey,
  QQ_BOT_KIND_PROMPT,
} from '../src/qq-bot-kind-prompt.js';
import { qqRuntimeStateToken } from '../src/qq-runtime-state.js';

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
    // 让 qq.endpoint cancel 等命令继续走命令链
    if (raw.toLowerCase().startsWith('qq.endpoint')) {
      await next();
      return;
    }

    const botKind = parseQqBotKindAnswer(raw);
    if (!botKind) {
      await context.input.$reply?.(
        `未识别「${raw}」。${QQ_BOT_KIND_PROMPT}`,
      );
      return;
    }

    try {
      const text = completeQqPendingBotKind(pending, botKind);
      state.pendingBotKind = null;
      await context.input.$reply?.(text);
    } catch (error) {
      await context.input.$reply?.(
        `写入配置失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
