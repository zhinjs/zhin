import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import {
  buildChoiceFallbackMap,
  channelKey,
  messageFromCommandInput,
  parseChoicePayload,
  resolveGameTextPayload,
} from '@zhin.js/game-kit';
import { getGameServices } from '../src/runtime-store.js';
import { DICE_PREFIX, handleChoice } from '../src/game-flow.js';
import type { SessionService } from '../src/session-service.js';

/**
 * 文本入口：按钮 payload（`dice:session:roll|restart`）与数字 fallback
 * （『回复 1 掷骰』，对应 view 的 fallbackHint）。
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const raw = context.input.content?.trim() ?? '';
    if (!raw) {
      await next();
      return;
    }
    const services = getGameServices<SessionService>();
    if (!services) {
      await next();
      return;
    }
    const message = messageFromCommandInput(context.input);
    const ch = channelKey(message);

    // 直接 payload（QQ 指令预填 / Sandbox action→text）
    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${DICE_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, DICE_PREFIX);
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

    const map = buildChoiceFallbackMap(DICE_PREFIX, session.id, [{ id: 'roll', label: '掷骰' }]);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, DICE_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) {
      await next();
      return;
    }

    const reply = await handleChoice(null, services, message, session.id, 'roll');
    if (reply) await context.input.$reply(reply);
  },
});
