import { describe, expect, it } from 'vitest';
import { parseCards, parseDeck } from '../src/session-service.js';

describe('blackjack session parse', () => {
  const sample = ['4♥', 'J♠', '5♦'];

  it('parses JSON string from create()', () => {
    expect(parseDeck(JSON.stringify(sample))).toEqual(sample);
    expect(parseCards(JSON.stringify(sample))).toEqual(sample);
  });

  it('accepts array already deserialized by SQLite dialect', () => {
    expect(parseDeck(sample)).toEqual(sample);
    expect(parseCards(sample)).toEqual(sample);
  });
});
