import { replyGameOperation, gamePlayerFromInput, parseChoicePayload, resolveGameTextPayload } from '@zhin.js/game-kit';
import type { Message } from '@zhin.js/core/runtime';
import { defineMiddleware } from 'zhin.js/middleware';
import { handleGuessChoice } from '../../src/game-flow.js';
import { resolveGameServices } from '../../src/runtime-store.js';
import { GUESS_PREFIX } from '../../src/view.js';

export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    if (!context.input.sender?.id) { await next(); return; }
    const raw = context.input.content?.trim() ?? '';
    const payload = resolveGameTextPayload(raw);
    if (!payload?.startsWith(`${GUESS_PREFIX}:`)) {
      await next();
      return;
    }
    const parsed = parseChoicePayload(payload, GUESS_PREFIX);
    if (!parsed || (parsed.choiceId !== 'quit' && parsed.choiceId !== 'restart')) {
      await next();
      return;
    }
    const services = resolveGameServices(context);
    const message = gamePlayerFromInput(context.input);
    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => handleGuessChoice(
      services,
      message,
      parsed.sessionId,
      parsed.choiceId,
    ) });
  },
});
