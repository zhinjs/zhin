import { defineMiddleware } from '@zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { messageFromCommandInput } from '@zhin.js/game-kit';
import { resolveGameServices } from '../src/runtime-store.js';
import { processGuess } from '../src/game-flow.js';

export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const raw = context.input.content?.trim() ?? '';
    if (!/^(\d+)$/.test(raw)) {
      await next();
      return;
    }
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(context.input) as never;
    const reply = await processGuess(services, message, Number(raw));
    if (reply) {
      await context.input.$reply(reply);
      return;
    }
    await next();
  },
});
