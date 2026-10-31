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
import { handleDungeonChoice } from '../../src/game-flow.js';
import { resolveGameServices } from '../../src/runtime-store.js';
import { stateFromSession } from '../../src/session-service.js';
import {
  DUNGEON_PREFIX,
  choicesForState,
  dungeonSessionToken,
} from '../../src/view.js';

export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    if (!context.input.sender?.id) { await next(); return; }
    const raw = context.input.content?.trim() ?? '';
    if (!raw) {
      await next();
      return;
    }
    const service = resolveGameServices(context);
    const message = gamePlayerFromInput(context.input);
    const payloadFromText = resolveGameTextPayload(raw);
    if (payloadFromText?.startsWith(`${DUNGEON_PREFIX}:`)) {
      const parsed = parseChoicePayload(payloadFromText, DUNGEON_PREFIX);
      if (parsed) {
        await replyGameOperation({ session: service, player: message, reply: content => context.input.$reply(content),
      run: () => handleDungeonChoice(
          service,
          message,
          parsed.sessionId,
          parsed.choiceId,
        ) });
        return;
      }
      await next();
      return;
    }

    const session = await service.getActiveByChannel(channelKey(message));
    if (!session) {
      await next();
      return;
    }
    const choices = choicesForState(stateFromSession(session));
    const map = buildChoiceFallbackMap(
      DUNGEON_PREFIX,
      dungeonSessionToken(session),
      choices,
    );
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, DUNGEON_PREFIX) : null;
    if (!parsed) {
      await next();
      return;
    }
    await replyGameOperation({ session: service, player: message, reply: content => context.input.$reply(content),
      run: () => handleDungeonChoice(
      service,
      message,
      parsed.sessionId,
      parsed.choiceId,
    ) });
  },
});
