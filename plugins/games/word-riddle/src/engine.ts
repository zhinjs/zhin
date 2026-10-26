import { createMessages, type Locale } from 'zhin.js/i18n';
import {
  getRiddleById,
  type RiddleEntry,
  type RiddleType,
} from './riddle-provider.js';

export type { RiddleType };

export const RIDDLE_PREFIX = 'riddle';

export function normalizeAnswer(raw: string): string {
  return raw.trim().replace(/\s/g, '').replace(/[。.!！?？,，]/g, '');
}

export function answersFor(entry: RiddleEntry): string[] {
  const all = [entry.answer, ...(entry.aliases ?? [])];
  return [...new Set(all.map(normalizeAnswer))];
}

export function checkAnswer(entry: RiddleEntry, raw: string): boolean {
  const a = normalizeAnswer(raw);
  if (!a) return false;
  return answersFor(entry).some((x) => x === a);
}

export function typeLabel(type: RiddleType, locale?: Locale): string {
  return type === 'char' ? messages(locale, 'text1') : messages(locale, 'text2');
}

export { getRiddleById };

const messages = createMessages({
  text1: { 'zh-CN': "字谜", en: "Chinese Character Riddles" },
  text2: { 'zh-CN': "猜成语", en: "Chinese Idiom Riddles" },
});
