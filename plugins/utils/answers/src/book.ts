import { createHash, randomInt } from 'node:crypto';
import { BOOK_ANSWERS } from './book-data.js';

export const BOOK_USAGE = [
  '📖 答案之书',
  '用法：答案之书 <问题>',
  '例如：答案之书 今天要不要出去走走',
  '心里默念问题后发送，书会翻开一页给你答案。',
].join('\n');

export const MAX_QUESTION_LENGTH = 200;

export interface BookPickInput {
  readonly question: string;
  readonly senderId: string;
  /** 为 true 时，同一用户同一天的同一问题得到相同答案。 */
  readonly dailyStable: boolean;
  readonly timezone: string;
  readonly now?: number;
}

/** 规范化问题：去掉空白与常见标点，避免「？」和「?」得到不同答案。 */
export function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

/** 给定时区下的日历日期（YYYY-MM-DD）；时区无效时退回 UTC。 */
export function calendarDay(now: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export function pickBookAnswer(input: BookPickInput, answers: readonly string[] = BOOK_ANSWERS): string {
  if (answers.length === 0) throw new Error('答案之书为空');
  if (!input.dailyStable) return answers[randomInt(answers.length)]!;
  const day = calendarDay(input.now ?? Date.now(), input.timezone);
  const digest = createHash('sha256')
    .update(JSON.stringify(['answers-book-v1', day, input.senderId, normalizeQuestion(input.question)]))
    .digest();
  return answers[digest.readUInt32BE(0) % answers.length]!;
}

export function replyBook(question: string, answer: string): string {
  return `📖 你问：${question}\n✨ 答案之书：${answer}`;
}
