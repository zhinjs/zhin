import type { Message } from '@zhin.js/core/runtime';
import { channelKey, gamePlayerFromInput, replyGameOperation } from '@zhin.js/game-kit';
import { defineMiddleware } from 'zhin.js/middleware';
import { runRouletteCommand } from '../../src/roulette-command.js';
import { rouletteServicesToken } from '../../src/runtime.js';

const FIRE_WORDS: readonly string[] = ['开枪', '扣动扳机'];

/**
 * A bare 「开枪」 fires only for the player whose turn it is in this group,
 * so the word stays ordinary chat everywhere else.
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    if (!context.input.sender?.id) { await next(); return; }
    const text = context.input.content?.trim() ?? '';
    if (!FIRE_WORDS.includes(text)) {
      await next();
      return;
    }
    const message = gamePlayerFromInput(context.input);
    const services = context.use(rouletteServicesToken);
    const session = await services.sessions.getActiveByChannel(channelKey(message));
    if (!session || session.turn !== message.sender.id) {
      await next();
      return;
    }
    await replyGameOperation({ session: services.sessions, player: message, reply: content => context.input.$reply(content),
      run: () => runRouletteCommand(context, context.input, 'fire') });
  },
});
