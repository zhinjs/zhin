import type { Adapter, Message, Plugin } from 'zhin.js';
import { recordGameOutcome } from '@zhin.js/game-shared';
import {
  BJ_PREFIX,
  compareHands,
  dealerShouldHit,
  handValue,
  TARGET,
} from './engine.js';
import type { BjSessionRow } from './models.js';
import type { SessionService } from './session-service.js';
import { parseCards, parseDeck } from './session-service.js';
import { buildBjView, naturalOutcome, playerBust } from './view.js';

async function sendOrEditView(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  session: BjSessionRow,
  terminal = false,
  revealDealer = false,
): Promise<void> {
  const content = buildBjView(session, terminal, revealDealer, message.$channel.type);
  const adapter = plugin.root.inject(message.$adapter) as Adapter;

  if (session.board_message_id) {
    const msgId = await adapter.editMessage({
      messageId: session.board_message_id,
      context: String(message.$adapter),
      endpoint: message.$endpoint,
      id: message.$channel.id,
      type: message.$channel.type,
      content,
    });
    if (msgId !== session.board_message_id) {
      await services.updateSession(session.id, { board_message_id: msgId });
    }
    return;
  }

  const msgId = await message.$reply?.(content);
  if (msgId) await services.updateSession(session.id, { board_message_id: msgId });
}

async function finishRound(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  session: BjSessionRow,
  status: BjSessionRow['status'],
): Promise<void> {
  await services.updateSession(session.id, { status });
  const updated = (await services.getById(session.id))!;
  if (status === 'won') void recordGameOutcome(message, 'blackjack', 'won', 30);
  else if (status === 'lost') void recordGameOutcome(message, 'blackjack', 'lost');
  else if (status === 'draw') void recordGameOutcome(message, 'blackjack', 'draw');
  await sendOrEditView(plugin, services, message, updated, true, true);
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
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
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
    await finishRound(plugin, services, message, session, natural);
    return undefined;
  }
  await sendOrEditView(plugin, services, message, session);
  return undefined;
}

export async function continueGame(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
): Promise<string> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的 21 点，发送「21点 开始」。';
  await sendOrEditView(plugin, services, message, session);
  return '已刷新 21 点界面。';
}

export async function handleChoice(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  sessionId: string,
  choiceId: string,
): Promise<string | null> {
  const session = await services.getById(sessionId);
  if (!session) return '对局不存在。';
  if (session.player_id !== message.$sender.id) return '这是别人的对局。';

  if (session.status !== 'active' && choiceId === 'restart') {
    await services.updateSession(session.id, { status: 'aborted' });
    await startGame(plugin, services, message);
    return null;
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
      await finishRound(plugin, services, message, session, 'lost');
      return null;
    }
    const updated = (await services.getById(session.id))!;
    await sendOrEditView(plugin, services, message, updated);
    return null;
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
  await finishRound(plugin, services, message, session, status);
  return null;
}

export { BJ_PREFIX, handValue, TARGET };
