import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from '@zhin.js/core';
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
    '🃏 **21 点**',
    '',
    `你的牌：${formatHand(player)}`,
    `庄家：${revealDealer || terminal ? formatHand(dealer) : formatHand(dealer, true)}`,
    '',
  ];

  if (terminal) {
    if (session.status === 'won') lines.push('🎉 **你赢了！**');
    else if (session.status === 'lost') lines.push('💀 **你输了**');
    else lines.push('🤝 **平局**');
    lines.push('', '点击「再来一局」或发送 `/21点 开始`');
  } else {
    lines.push(`目标：尽量接近 ${TARGET} 且不超过。`);
  }

  const choices = terminal
    ? [{ id: 'restart', label: '🔄 再来一局', style: 'primary' as const, keepEnabledWhenTerminal: true }]
    : [
        { id: 'hit', label: '➕ 要牌', style: 'primary' as const },
        { id: 'stand', label: '✋ 停牌', style: 'secondary' as const },
      ];

  return buildChoiceKeyboard({
    gamePrefix: BJ_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    fallbackHint: terminal ? '回复 1 再来一局' : '1 要牌 · 2 停牌',
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
