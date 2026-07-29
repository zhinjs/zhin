import { plainTextFromSendContent, recordGameOutcome, type GameMessageLike } from '@zhin.js/game-kit';
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
  message: GameMessageLike,
  terminal = false,
  revealDealer = false,
): string {
  const content = buildBjView(session, terminal, revealDealer, message.$channel.type);
  return plainTextFromSendContent(content);
}

async function finishRound(
  services: SessionService,
  message: GameMessageLike,
  session: BjSessionRow,
  status: BjSessionRow['status'],
): Promise<string> {
  await services.updateSession(session.id, { status });
  const updated = (await services.getById(session.id))!;
  if (status === 'won') void recordGameOutcome(message, 'blackjack', 'won', 30);
  else if (status === 'lost') void recordGameOutcome(message, 'blackjack', 'lost');
  else if (status === 'draw') void recordGameOutcome(message, 'blackjack', 'draw');
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
  message: GameMessageLike,
): Promise<string | undefined> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.getActiveByChannel(ch);
  if (active) {
    if (active.player_id === message.$sender.id) {
      return '你已有进行中的 21 点，发送「21点 继续」刷新。';
    }
    return `本频道 ${active.player_name} 正在玩 21 点。`;
  }
  const session = await services.createSession(message);
  const natural = naturalOutcome(session);
  if (natural) {
    return finishRound(services, message, session, natural);
  }
  return renderView(session, message);
}

export async function continueGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<string> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的 21 点，发送「21点 开始」。';
  return renderView(session, message);
}

export async function handleChoice(
  services: SessionService,
  message: GameMessageLike,
  sessionId: string,
  choiceId: string,
): Promise<string | null> {
  const session = await services.getById(sessionId);
  if (!session) return '对局不存在。';
  if (session.player_id !== message.$sender.id) return '这是别人的对局。';

  if (session.status !== 'active' && choiceId === 'restart') {
    await services.updateSession(session.id, { status: 'aborted' });
    return (await startGame(services, message)) ?? null;
  }

  if (session.status !== 'active') return '对局已结束，请点击再来一局。';

  const deck = parseDeck(session.deck_json);
  let player = parseCards(session.player_cards_json);
  let dealer = parseCards(session.dealer_cards_json);

  if (choiceId === 'hit') {
    const card = deck.pop();
    if (!card) return '牌堆已空。';
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

  if (choiceId !== 'stand') return '无效操作。';

  dealer = await dealerPlay(deck, dealer);
  await services.updateSession(session.id, {
    deck_json: JSON.stringify(deck),
    dealer_cards_json: JSON.stringify(dealer),
  });
  const outcome = compareHands(player, dealer);
  const status: BjSessionRow['status'] =
    outcome === 'won' ? 'won' : outcome === 'lost' ? 'lost' : 'draw';
  return finishRound(services, message, session, status);
}

export { BJ_PREFIX, handValue, TARGET };
