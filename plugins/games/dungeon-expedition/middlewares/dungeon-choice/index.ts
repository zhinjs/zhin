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
  abortConfirmChoices,
  choicesForState,
  dungeonSessionToken,
  hasPendingAbort,
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
        await replyGameOperation({ session: service, player: message, reply: content => context.input.$reply(content), input: context.input,
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
    const state = stateFromSession(session);
    const token = dungeonSessionToken(session);
    // The leader answering their own pending end confirmation: numbers and labels follow that
    // card (1 确认结束 / 2 继续远征). It exists only at the revision the request created (#1250).
    const confirming = state.ownerId === message.sender.id && hasPendingAbort(session, state);
    // Everyone else answers the shared card (same buttons and numbers for all, #1250). 群里远征队是
    // 整频道共享的：不在队伍里的人只能用文字「加入」，其余文字（攻击、防御、序号…）按普通聊天放行，
    // 不被别人的对局截走（#1250）。
    const member = state.players.some(player => player.id === message.sender.id);
    const full = buildChoiceFallbackMap(DUNGEON_PREFIX, token, confirming ? abortConfirmChoices() : choicesForState(state));
    // Filtering never renumbers: 「1」 is 加入 on everyone's card; a member's 「1」 / 「加入队伍」 is chat.
    const map = Object.fromEntries(Object.entries(full).filter(([, value]) => value.endsWith(':join') !== member));
    const payload = resolveGameTextPayload(raw, map);
    const parsed = payload ? parseChoicePayload(payload, DUNGEON_PREFIX) : null;
    if (!parsed) {
      await next();
      return;
    }
    await replyGameOperation({ session: service, player: message, reply: content => context.input.$reply(content), input: context.input,
      run: () => handleDungeonChoice(
      service,
      message,
      parsed.sessionId,
      parsed.choiceId,
    ) });
  },
});
