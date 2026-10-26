import { createMessages } from 'zhin.js/i18n';
import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from '@zhin.js/core/runtime';
import { BJ_PREFIX, formatHand, handValue, isBlackjack, TARGET } from './engine.js';
import type { BjSessionRow } from './models.js';
import { parseCards } from './session-service.js';

export function buildBjView(
  session: BjSessionRow,
  terminal = false,
  revealDealer = false,
  channelType?: string,
): SendContent {
  const player = parseCards(session.player_cards_json);
  const dealer = parseCards(session.dealer_cards_json);
  const lines = [
    messages(session.locale ?? undefined, 'text1'),
    '',
    messages(session.locale ?? undefined, 'text2', { p0: formatHand(player) }),
    messages(session.locale ?? undefined, 'text3', { p0: revealDealer || terminal ? formatHand(dealer) : formatHand(dealer, true) }),
    '',
  ];

  if (terminal) {
    if (session.status === 'won') lines.push(messages(session.locale ?? undefined, 'text4'));
    else if (session.status === 'lost') lines.push(messages(session.locale ?? undefined, 'text5'));
    else if (session.status === 'draw') lines.push(messages(session.locale ?? undefined, 'text6'));
    else lines.push(messages(session.locale ?? undefined, 'text7'));
    lines.push('', messages(session.locale ?? undefined, 'text8'));
  } else {
    lines.push(messages(session.locale ?? undefined, 'text9', { p0: TARGET }));
  }

  const choices = terminal
    ? [{ id: 'restart', label: messages(session.locale ?? undefined, 'text10'), style: 'primary' as const, keepEnabledWhenTerminal: true }]
    : [
        { id: 'hit', label: messages(session.locale ?? undefined, 'text11'), style: 'primary' as const },
        { id: 'stand', label: messages(session.locale ?? undefined, 'text12'), style: 'secondary' as const },
        { id: 'quit', label: messages(session.locale ?? undefined, 'text13'), style: 'danger' as const },
      ];

  return buildChoiceKeyboard({
    gamePrefix: BJ_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    fallbackHint: terminal ? messages(session.locale ?? undefined, 'text14') : messages(session.locale ?? undefined, 'text15'),
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}

export function checkNaturalBlackjack(session: BjSessionRow): boolean {
  const player = parseCards(session.player_cards_json);
  const dealer = parseCards(session.dealer_cards_json);
  return isBlackjack(player) || isBlackjack(dealer);
}

export function naturalOutcome(session: BjSessionRow): 'won' | 'lost' | 'draw' | null {
  const player = parseCards(session.player_cards_json);
  const dealer = parseCards(session.dealer_cards_json);
  const pbj = isBlackjack(player);
  const dbj = isBlackjack(dealer);
  if (!pbj && !dbj) return null;
  if (pbj && dbj) return 'draw';
  if (pbj) return 'won';
  return 'lost';
}

export function playerBust(session: BjSessionRow): boolean {
  return handValue(parseCards(session.player_cards_json)) > TARGET;
}

const messages = createMessages({
  text1: { 'zh-CN': "🃏 **21 点**", en: "🃏 **Blackjack**" },
  text2: { 'zh-CN': "你的牌：{p0}", en: "Your hand: {p0}" },
  text3: { 'zh-CN': "庄家：{p0}", en: "Dealer: {p0}" },
  text4: { 'zh-CN': "🎉 **你赢了！**", en: "🎉 **You won!**" },
  text5: { 'zh-CN': "💀 **你输了**", en: "💀 **You lost**" },
  text6: { 'zh-CN': "🤝 **平局**", en: "🤝 **Draw**" },
  text7: { 'zh-CN': "🏳️ **本局已放弃。**", en: "🏳️ **You quit this game.**" },
  text8: { 'zh-CN': "点击「再来一局」开始新局。", en: "Choose “Play again” to start a new game." },
  text9: { 'zh-CN': "目标：尽量接近 {p0} 且不超过。", en: "Get as close to {p0} as possible without going over." },
  text10: { 'zh-CN': "🔄 再来一局", en: "🔄 Play again" },
  text11: { 'zh-CN': "➕ 要牌", en: "➕ Hit" },
  text12: { 'zh-CN': "✋ 停牌", en: "✋ Stand" },
  text13: { 'zh-CN': "🏳️ 放弃", en: "🏳️ Quit" },
  text14: { 'zh-CN': "回复 1 再来一局", en: "Reply 1 to play again" },
  text15: { 'zh-CN': "1 要牌 · 2 停牌 · 3 放弃", en: "1 Hit · 2 Stand · 3 Quit" },
});
