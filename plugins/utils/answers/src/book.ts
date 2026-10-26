import { type Locale } from 'zhin.js/i18n';
import { messages } from './messages.js';
import { createHash, randomInt } from 'node:crypto';
import { BOOK_ANSWERS } from './book-data.js';

export function bookUsage(locale: Locale = 'zh-CN', command?: string): string {
  return [messages(locale, 'bookTitle'), ...(command === undefined ? [] : [messages(locale, 'bookUsage', { command })]), messages(locale, 'bookIntro')].join('\n');
}
export const BOOK_USAGE = bookUsage();

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

export function replyBook(question: string, answer: string, locale: Locale = 'zh-CN'): string {
  return messages(locale, 'bookReply', { question, answer });
}
