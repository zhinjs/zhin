import type { Message } from '@zhin.js/core/runtime';
import { channelKey, messageFromCommandInput } from '@zhin.js/game-kit';
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
    const text = context.input.content?.trim() ?? '';
    if (!FIRE_WORDS.includes(text)) {
      await next();
      return;
    }
    const message = messageFromCommandInput(context.input);
    const services = context.use(rouletteServicesToken);
    const session = await services.sessions.getActiveByChannel(channelKey(message));
    if (!session || session.turn !== message.$sender.id) {
      await next();
      return;
    }
    const reply = await runRouletteCommand(context, context.input, 'fire');
    if (reply) await context.input.$reply(reply);
  },
});
