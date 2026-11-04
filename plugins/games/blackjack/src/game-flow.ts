import { createMessages, resolveLocale } from 'zhin.js/i18n';
import { channelKey, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import {
  BJ_PREFIX,
  compareHands,
  dealerShouldHit,
  handValue,
  TARGET,
} from './engine.js';
import type { BjSessionRow } from './models.js';
import { parseCards, parseDeck, type SessionService } from './session-service.js';

import { buildBjView, naturalOutcome, playerBust } from './view.js';

/**
 * Plugin Runtime: render the board as text. Interactive in-place board editing
 * (the old Adapter.editMessage path) is not part of the runtime flow; commands
 * and the choice middleware return fresh text each turn.
 */
function renderView(
  session: BjSessionRow,
  message: GamePlayer,
  terminal = false,
  revealDealer = false,
): GameReply {
  return buildBjView(session, terminal, revealDealer, message.target.kind);
}

async function finishRound(
  services: SessionService,
  message: GamePlayer,
  session: BjSessionRow,
  status: BjSessionRow['status'],
): Promise<GameReply> {
  await services.updateSession(session.id, { status });
  const updated = (await services.getById(session.id))!;
  return renderView(updated, message, true, true);
}

async function dealerPlay(
  deck: string[],
  dealer: string[],
): Promise<string[]> {
  const hand = [...dealer];
  while (dealerShouldHit(hand)) {
    const card = deck.pop();
    if (!card) break;
    hand.push(card);
  }
  return hand;
}

export async function startGame(
  services: SessionService,
  message: GamePlayer,
): Promise<GameReply | undefined> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const ch = channelKey(message);
    const active = await services.getActiveByChannel(ch);
    const locale = resolveLocale(active ? active.locale : message.locale);
    if (active) {
      if (active.player_id === message.sender.id) {
        return messages(locale, 'text1');
      }
      return messages(locale, 'text2', { p0: active.player_name });
    }
    const session = await services.createSession(message);
    const natural = naturalOutcome(session);
    if (natural) {
      return finishRound(services, message, session, natural);
    }
    return renderView(session, message);
  } });
}

export async function continueGame(
  services: SessionService,
  message: GamePlayer,
): Promise<GameReply> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const session = await services.getActiveForUser(
      channelKey(message),
      message.sender.id,
    );
    const locale = resolveLocale(session ? session.locale : message.locale);
    if (!session) return messages(locale, 'text3');
    return renderView(session, message);
  } });
}

export async function handleChoice(
  services: SessionService,
  message: GamePlayer,
  sessionId: string,
  choiceId: string,
): Promise<GameReply | null> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const session = await services.getById(sessionId);
    const locale = resolveLocale(session ? session.locale : message.locale);
    if (!session) return messages(locale, 'text4');
    if (session.player_id !== message.sender.id) return messages(locale, 'text5');

    if (session.status !== 'active' && choiceId === 'restart') {
      await services.updateSession(session.id, { status: 'aborted' });
      return (await startGame(services, message)) ?? null;
    }

    if (session.status !== 'active') return messages(locale, 'text6');

    if (choiceId === 'quit') {
      await services.updateSession(session.id, { status: 'aborted' });
      return renderView((await services.getById(session.id))!, message, true, true);
    }

    const deck = parseDeck(session.deck_json);
    let player = parseCards(session.player_cards_json);
    let dealer = parseCards(session.dealer_cards_json);

    if (choiceId === 'hit') {
      const card = deck.pop();
      if (!card) return messages(locale, 'text7');
      player = [...player, card];
      await services.updateSession(session.id, {
        deck_json: JSON.stringify(deck),
        player_cards_json: JSON.stringify(player),
      });
      if (playerBust({ ...session, player_cards_json: JSON.stringify(player) })) {
        return finishRound(services, message, session, 'lost');
      }
      const updated = (await services.getById(session.id))!;
      return renderView(updated, message);
    }

    if (choiceId !== 'stand') return messages(locale, 'text8');

    dealer = await dealerPlay(deck, dealer);
    await services.updateSession(session.id, {
      deck_json: JSON.stringify(deck),
      dealer_cards_json: JSON.stringify(dealer),
    });
    const outcome = compareHands(player, dealer);
    const status: BjSessionRow['status'] =
      outcome === 'won' ? 'won' : outcome === 'lost' ? 'lost' : 'draw';
    return finishRound(services, message, session, status);
  } });
}

export { BJ_PREFIX, handValue, TARGET };

const messages = createMessages({
  text1: { 'zh-CN': "你已有进行中的 21 点，请使用当前对局的操作入口。", en: "You already have an active blackjack game. Continue using its controls." },
  text2: { 'zh-CN': "本频道 {p0} 正在玩 21 点。", en: "{p0} is playing blackjack in this channel." },
  text3: { 'zh-CN': "你没有进行中的 21 点，请使用当前对局的操作入口。", en: "You have no active blackjack game." },
  text4: { 'zh-CN': "对局不存在。", en: "This game no longer exists." },
  text5: { 'zh-CN': "这是别人的对局。", en: "This game belongs to another player." },
  text6: { 'zh-CN': "对局已结束，请点击再来一局。", en: "This game has ended. Choose Play again." },
  text7: { 'zh-CN': "牌堆已空。", en: "The deck is empty." },
  text8: { 'zh-CN': "无效操作。", en: "Invalid action." },
});
