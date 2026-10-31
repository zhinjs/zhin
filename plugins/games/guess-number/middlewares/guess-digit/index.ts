import { replyGameOperation, gamePlayerFromInput } from '@zhin.js/game-kit';
import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGameServices } from '../../src/runtime-store.js';
import { processGuess } from '../../src/game-flow.js';

export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    if (!context.input.sender?.id) { await next(); return; }
    const raw = context.input.content?.trim() ?? '';
    if (!/^(\d+)$/.test(raw)) {
      await next();
      return;
    }
    const services = resolveGameServices(context);
    const message = gamePlayerFromInput(context.input);
    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => processGuess(services, message, Number(raw)) });
    await next();
  },
});
