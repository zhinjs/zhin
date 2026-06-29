import { describe, expect, it } from 'vitest';
import {
  compareHands,
  freshDeck,
  handValue,
  isBlackjack,
} from '../src/engine.js';

describe('blackjack engine', () => {
  it('freshDeck has 52 unique cards', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it('handValue handles aces', () => {
    expect(handValue(['A♠', 'K♥'])).toBe(21);
    expect(handValue(['A♠', 'A♥', '9♦'])).toBe(21);
    expect(handValue(['A♠', 'A♥', 'A♦', 'K♣'])).toBe(13);
  });

  it('detects natural blackjack', () => {
    expect(isBlackjack(['A♠', '10♥'])).toBe(true);
    expect(isBlackjack(['A♠', '9♥'])).toBe(false);
  });

  it('compareHands resolves bust and tie', () => {
    expect(compareHands(['K♠', '5♥'], ['K♦', '6♣'])).toBe('lost');
    expect(compareHands(['K♠', '7♥'], ['K♦', '6♣'])).toBe('won');
    expect(compareHands(['K♠', 'Q♥'], ['K♦', 'Q♣'])).toBe('draw');
    expect(compareHands(['K♠', 'Q♥', '5♦'], ['K♦', '6♣'])).toBe('lost');
  });
});
