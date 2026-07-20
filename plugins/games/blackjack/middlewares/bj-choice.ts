import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import {
  buildChoiceFallbackMap,
  channelKey,
  messageFromCommandInput,
  parseChoicePayload,
  resolveGameTextPayload,
} from '@zhin.js/game-kit';
import { resolveGameServices } from '../src/runtime-store.js';
import { BJ_PREFIX, handleChoice } from '../src/game-flow.js';

/**
 * 文本入口：按钮 payload（`bj:session:hit|stand|restart`）与数字 fallback
 * （『1 要牌 2 停牌』、终局『1 再来一局』，对应 view 的 fallbackHint）。
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const raw = context.input.content?.trim() ?? '';
    if (!raw) {
      await next();
      return;
    }
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(context.input);
    const ch = channelKey(message);

    // 直接 payload（QQ 指令预填 / Sandbox action→text）
    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${BJ_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, BJ_PREFIX);
      if (parsed) {
        const session = await services.getById(parsed.sessionId);
        if (session?.channel_key === ch) {
          const reply = await handleChoice(null, services, message, parsed.sessionId, parsed.choiceId);
          if (reply) await context.input.$reply(reply);
          return;
        }
      }
      await next();
      return;
    }

    const session = await services.getActiveForUser(ch, message.$sender.id);
    if (!session) {
      await next();
      return;
    }

    if (session.status !== 'active') {
      const map = buildChoiceFallbackMap(BJ_PREFIX, session.id, [
        { id: 'restart', label: '再来一局', keepEnabledWhenTerminal: true },
      ]);
      const payload = resolveGameTextPayload(raw, map);
      const parsed = payload ? parseChoicePayload(payload, BJ_PREFIX) : null;
      if (parsed?.choiceId === 'restart') {
        const reply = await handleChoice(null, services, message, parsed.sessionId, 'restart');
        if (reply) await context.input.$reply(reply);
        return;
      }
      await next();
      return;
    }

    const map = buildChoiceFallbackMap(BJ_PREFIX, session.id, [
      { id: 'hit', label: '要牌' },
      { id: 'stand', label: '停牌' },
    ]);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, BJ_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) {
      await next();
      return;
    }

    const reply = await handleChoice(null, services, message, session.id, parsed.choiceId);
    if (reply) await context.input.$reply(reply);
  },
});
