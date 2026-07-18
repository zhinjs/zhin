import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { messageFromCommandInput } from '@zhin.js/game-kit';
import { getGameServices } from '../src/runtime-store.js';
import { processGuess } from '../src/game-flow.js';
import type { SessionService } from '../src/session-service.js';

export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const raw = context.input.content?.trim() ?? '';
    if (!/^(\d+)$/.test(raw)) {
      await next();
      return;
    }
    const services = getGameServices<SessionService>();
    if (!services) {
      await next();
      return;
    }
    const message = messageFromCommandInput(context.input) as never;
    const reply = await processGuess(services, message, Number(raw));
    if (reply) {
      await context.input.$reply(reply);
      return;
    }
    await next();
  },
});
