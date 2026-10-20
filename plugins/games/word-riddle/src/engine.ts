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

export function typeLabel(type: RiddleType): string {
  return type === 'char' ? '字谜' : '猜成语';
}

export { getRiddleById };
