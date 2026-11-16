import {
  replyGameOperation,
  buildChoiceFallbackMap,
  channelKey,
  gamePlayerFromInput,
  parseChoicePayload,
  resolveGameTextPayload,
} from '@zhin.js/game-kit';
import type { Message } from '@zhin.js/core/runtime';
import { defineMiddleware } from 'zhin.js/middleware';
import { handleGuessChoice } from '../../src/game-flow.js';
import { resolveGameServices } from '../../src/runtime-store.js';
import { GUESS_PREFIX } from '../../src/view.js';

/** 终局后文字重开的有效期：超过它，「再来一局」按普通聊天放行。 */
const TEXT_RESTART_WINDOW_MS = 10 * 60_000;

/**
 * 按钮 payload（`guess:session:quit|restart`）与按钮文字（「放弃」「再来一局」，#1250）。
 * 数字是猜测本身（guess-digit），这里不接受序号。
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    if (!context.input.sender?.id) { await next(); return; }
    const raw = context.input.content?.trim() ?? '';
    if (!raw || /^\d+$/u.test(raw)) { await next(); return; }
    const services = resolveGameServices(context);
    const message = gamePlayerFromInput(context.input);
    let payload = resolveGameTextPayload(raw);
    if (!payload?.startsWith(`${GUESS_PREFIX}:`)) {
      const session = await services.getLatestForUser(channelKey(message), message.sender.id);
      if (!session) { await next(); return; }
      // 终局后的「再来一局」只在刚结束的一局上生效，旧对局不再劫持普通聊天（#1250）。
      if (session.status !== 'active' && Date.now() - session.updated_at > TEXT_RESTART_WINDOW_MS) { await next(); return; }
      const choice = session.status === 'active'
        ? { id: 'quit', label: '放弃' }
        : { id: 'restart', label: '再来一局' };
      const map = buildChoiceFallbackMap(GUESS_PREFIX, session.id, [choice]);
      // 只认按钮文字：去掉序号键，数字留给 guess-digit。
      delete map['1'];
      payload = resolveGameTextPayload(raw, map);
      if (!payload) { await next(); return; }
    }
    const parsed = parseChoicePayload(payload, GUESS_PREFIX);
    if (!parsed || (parsed.choiceId !== 'quit' && parsed.choiceId !== 'restart')) {
      await next();
      return;
    }
    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content), input: context.input,
      run: () => handleGuessChoice(
      services,
      message,
      parsed.sessionId,
      parsed.choiceId,
    ) });
  },
});
