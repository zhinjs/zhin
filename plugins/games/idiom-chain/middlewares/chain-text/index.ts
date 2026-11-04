import {
  replyGameOperation,
  buildChoiceFallbackMap,
  channelKey,
  gamePlayerFromInput,
  parseChoicePayload,
  resolveGameTextPayload,
} from '@zhin.js/game-kit';
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGameServices } from '../../src/runtime-store.js';
import { CHAIN_PREFIX, handleChoice, processIdiomText } from '../../src/game-flow.js';

/**
 * 文本入口：按钮 payload（`chain:session:choiceId`）、数字 fallback
 * （『1提示 2跳过 3认输』，对应 view 的 fallbackHint），其余按成语接龙作答。
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    if (!context.input.sender?.id) { await next(); return; }
    const raw = context.input.content?.trim() ?? '';
    if (!raw) {
      await next();
      return;
    }
    const services = resolveGameServices(context);
    const message = gamePlayerFromInput(context.input);
    const ch = channelKey(message);

    // 直接 payload（QQ 指令预填 / Sandbox action→text）
    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${CHAIN_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, CHAIN_PREFIX);
      if (parsed) {
        const session = await services.getById(parsed.sessionId);
        if (session?.channel_key === ch) {
          await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => handleChoice(services, message, parsed.sessionId, parsed.choiceId) });
          return;
        }
      }
      await next();
      return;
    }

    const session = await services.getActiveForUser(ch, message.sender.id);
    if (!session) {
      await next();
      return;
    }

    if (session.status === 'active') {
      const map = buildChoiceFallbackMap(CHAIN_PREFIX, session.id, [
        { id: 'hint', label: '提示' },
        { id: 'skip', label: '跳过' },
        { id: 'quit', label: '认输' },
      ]);
      const payload = resolveGameTextPayload(raw, map);
      const parsed = payload ? parseChoicePayload(payload, CHAIN_PREFIX) : null;
      if (parsed?.sessionId === session.id) {
        await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => handleChoice(services, message, session.id, parsed.choiceId) });
        return;
      }
    }

    // 仅把 2-8 个汉字的纯文本当成语作答，其余放行
    if (/^[\u4e00-\u9fff]{2,8}$/.test(raw)) {
      await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => processIdiomText(services, message, raw) });
      return;
    }

    await next();
  },
});
