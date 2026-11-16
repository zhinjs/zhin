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
import { BJ_PREFIX, handleChoice } from '../../src/game-flow.js';

/** 终局后文字/序号重开的有效期：超过它，「再来一局」「1」按普通聊天放行。 */
const TEXT_RESTART_WINDOW_MS = 10 * 60_000;

/**
 * 文本入口：按钮 payload（`bj:session:hit|stand|restart`）与数字 fallback
 * （『1 要牌 2 停牌』、终局『1 再来一局』，对应 view 的 fallbackHint）。
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
    if (payloadFromText?.startsWith(`${BJ_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, BJ_PREFIX);
      if (parsed) {
        const session = await services.getById(parsed.sessionId);
        if (session?.channel_key === ch) {
          await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content), input: context.input,
      run: () => handleChoice(services, message, parsed.sessionId, parsed.choiceId) });
          return;
        }
      }
      await next();
      return;
    }

    // 不按 status 过滤取本频道本人最近一局：终局 session 也要能命中 restart 分支
    const session = await services.getLatestForUser(ch, message.sender.id);
    if (!session) {
      await next();
      return;
    }

    if (session.status !== 'active') {
      // 终局后的文字「再来一局」/序号只在刚结束的一局上生效，旧对局不再劫持普通聊天（#1250）。
      if (Date.now() - session.updated_at > TEXT_RESTART_WINDOW_MS) {
        await next();
        return;
      }
      const map = buildChoiceFallbackMap(BJ_PREFIX, session.id, [
        { id: 'restart', label: '再来一局', keepEnabledWhenTerminal: true },
      ]);
      const payload = resolveGameTextPayload(raw, map);
      const parsed = payload ? parseChoicePayload(payload, BJ_PREFIX) : null;
      if (parsed?.choiceId === 'restart') {
        await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content), input: context.input,
      run: () => handleChoice(services, message, parsed.sessionId, 'restart') });
        return;
      }
      await next();
      return;
    }

    const map = buildChoiceFallbackMap(BJ_PREFIX, session.id, [
      { id: 'hit', label: '要牌' },
      { id: 'stand', label: '停牌' },
      { id: 'quit', label: '放弃' },
    ]);
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, BJ_PREFIX) : null;
    if (!parsed || parsed.sessionId !== session.id) {
      await next();
      return;
    }

    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content), input: context.input,
      run: () => handleChoice(services, message, session.id, parsed.choiceId) });
  },
});
