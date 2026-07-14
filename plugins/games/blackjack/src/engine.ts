import { secureShuffleInPlace } from '@zhin.js/game-shared';

export const BJ_PREFIX = 'bj';
export const TARGET = 21;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const SUITS = ['♠', '♥', '♦', '♣'] as const;

export type Card = `${typeof RANKS[number]}${typeof SUITS[number]}`;

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(`${r}${s}` as Card);
    }
  }
  return secureShuffleInPlace(deck);
}

export function cardValue(rank: string): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

export function handValue(cards: readonly string[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const rank = c.slice(0, c.length - 1);
    if (rank === 'A') aces++;
    total += cardValue(rank);
  }
  while (total > TARGET && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function formatHand(cards: readonly string[], hideSecond = false): string {
  if (hideSecond && cards.length >= 2) {
    return `${cards[0]} 🂠 (${handValue([cards[0]!])})`;
  }
  return `${cards.join(' ')} (${handValue(cards)})`;
}

export function isBlackjack(cards: readonly string[]): boolean {
  return cards.length === 2 && handValue(cards) === TARGET;
}

export function dealerShouldHit(cards: readonly string[]): boolean {
  return handValue(cards) < 17;
}

export function compareHands(player: readonly string[], dealer: readonly string[]): 'won' | 'lost' | 'draw' {
  const pv = handValue(player);
  const dv = handValue(dealer);
  if (pv > TARGET) return 'lost';
  if (dv > TARGET) return 'won';
  if (pv > dv) return 'won';
  if (pv < dv) return 'lost';
  return 'draw';
}
