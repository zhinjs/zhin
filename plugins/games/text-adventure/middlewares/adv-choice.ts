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
import { handleChoice } from '../src/game-flow.js';
import { ADV_PREFIX, getScene, stateFromSession, visibleChoices } from '../src/story.js';
import type { GameServices } from '../src/session-service.js';

/**
 * 文本入口：按钮 payload（`adv:session:choiceId`）与数字 fallback
 * （按当前场景可见选项编号，对应视图提示用户回复数字选分支）。
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const raw = context.input.content?.trim() ?? '';
    if (!raw) {
      await next();
      return;
    }
    const services = getGameServices<GameServices>();
    if (!services) {
      await next();
      return;
    }
    const message = messageFromCommandInput(context.input);
    const ch = channelKey(message);

    // 直接 payload（QQ 指令预填 / Sandbox action→text）
    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${ADV_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, ADV_PREFIX);
      if (parsed) {
        const session = await services.sessions.getById(parsed.sessionId);
        if (session?.channel_key === ch) {
          const reply = await handleChoice(null, services, message, parsed.sessionId, parsed.choiceId);
          if (reply) await context.input.$reply(reply);
          return;
        }
      }
      await next();
      return;
    }

    const session = await services.sessions.getActiveForUser(ch, message.$sender.id);
    if (!session) {
      await next();
      return;
    }

    const scene = getScene(session.scene_id);
    if (!scene) {
      await next();
      return;
    }
    const state = stateFromSession(session);
    const choices = visibleChoices(scene, state);
    const map = buildChoiceFallbackMap(ADV_PREFIX, session.id, choices);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, ADV_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) {
      await next();
      return;
    }

    const reply = await handleChoice(null, services, message, session.id, parsed.choiceId);
    if (reply) await context.input.$reply(reply);
  },
});
