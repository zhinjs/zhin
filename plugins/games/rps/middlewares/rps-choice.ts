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
import { handleChoice, RPS_PREFIX } from '../src/game-flow.js';

/**
 * 文本入口：按钮 payload（`rps:session:rock|paper|scissors|restart`）与数字 fallback
 * （『1石头 2布 3剪刀』，对应 view 的 fallbackHint）。
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
    if (payloadFromText?.startsWith(`${RPS_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, RPS_PREFIX);
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
    if (!session || session.status !== 'active') {
      await next();
      return;
    }

    const map = buildChoiceFallbackMap(RPS_PREFIX, session.id, [
      { id: 'rock', label: '石头' },
      { id: 'paper', label: '布' },
      { id: 'scissors', label: '剪刀' },
    ]);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, RPS_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) {
      await next();
      return;
    }

    const reply = await handleChoice(null, services, message, session.id, parsed.choiceId);
    if (reply) await context.input.$reply(reply);
  },
});
