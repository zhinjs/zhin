export const GUESS_PREFIX = 'guess';
export const MIN = 1;
export const MAX = 100;
export const MAX_ATTEMPTS = 7;

export type GuessResult = 'win' | 'low' | 'high' | 'invalid';

export function newSecret(): number {
  return MIN + Math.floor(Math.random() * (MAX - MIN + 1));
}

export function evaluateGuess(secret: number, value: number): GuessResult {
  if (!Number.isInteger(value) || value < MIN || value > MAX) return 'invalid';
  if (value === secret) return 'win';
  return value < secret ? 'low' : 'high';
}

export function hintText(result: Exclude<GuessResult, 'win' | 'invalid'>, rangeMin: number, rangeMax: number): string {
  if (result === 'low') return `📈 **太小了！** 范围 ${rangeMin} ~ ${rangeMax}`;
  return `📉 **太大了！** 范围 ${rangeMin} ~ ${rangeMax}`;
}
