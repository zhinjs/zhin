import { createMessages, type Locale } from 'zhin.js/i18n';
import { secureRandomIntInclusive } from '@zhin.js/game-kit';

export const GUESS_PREFIX = 'guess';
export const MIN = 1;
export const MAX = 100;
export const MAX_ATTEMPTS = 7;

export type GuessResult = 'win' | 'low' | 'high' | 'invalid';

export function newSecret(): number {
  return secureRandomIntInclusive(MIN, MAX);
}

export function evaluateGuess(secret: number, value: number): GuessResult {
  if (!Number.isInteger(value) || value < MIN || value > MAX) return 'invalid';
  if (value === secret) return 'win';
  return value < secret ? 'low' : 'high';
}

export function hintText(result: Exclude<GuessResult, 'win' | 'invalid'>, rangeMin: number, rangeMax: number, locale?: Locale): string {
  if (result === 'low') return messages(locale, 'text1', { p0: rangeMin, p1: rangeMax });
  return messages(locale, 'text2', { p0: rangeMin, p1: rangeMax });
}

const messages = createMessages({
  text1: { 'zh-CN': "📈 **太小了！** 范围 {p0} ~ {p1}", en: "📈 **Too low!** Range {p0} ~ {p1}" },
  text2: { 'zh-CN': "📉 **太大了！** 范围 {p0} ~ {p1}", en: "📉 **Too high!** Range {p0} ~ {p1}" },
});
