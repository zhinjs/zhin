import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages } from './messages.js';
import { randomInt } from 'node:crypto';
import { QUIZ_LETTERS, type QuizLetter, type QuizQuestion } from './quiz-types.js';

export type QuizKind = 'fun' | 'driving';

/** Structural subset of the Runtime / Command message used to scope pending questions. */
export interface QuizConversationInput {
  readonly conversation?: {
    readonly endpoint?: { readonly id?: string; readonly adapter?: string };
    readonly kind?: string;
    readonly id?: string;
    readonly threadId?: string;
  };
  readonly sender?: { readonly id?: string } | string;
}

export interface PendingQuiz {
  readonly locale?: Locale;
  readonly kind: QuizKind;
  readonly question: QuizQuestion;
  readonly expiresAt: number;
}

export interface QuizJudgement {
  readonly correct: boolean;
  readonly chosen: QuizLetter;
  readonly pending: PendingQuiz;
}

/** Upper bound on simultaneously pending questions; the oldest one is dropped first. */
export const MAX_PENDING_QUIZZES = 1000;

/**
 * 题目只按「同一会话 + 同一发送者」隔离：A 出的题不能由 B 回答，
 * 同一用户在两个群里的题互不影响。返回 undefined 表示缺少可信身份，不出题。
 */
export function quizKey(input: QuizConversationInput | undefined): string | undefined {
  const conversation = input?.conversation;
  const sender = typeof input?.sender === 'string' ? input.sender : input?.sender?.id;
  if (!conversation?.id || !conversation.kind || !sender) return undefined;
  return JSON.stringify(['answers-quiz-v1', conversation.endpoint?.adapter ?? null, conversation.endpoint?.id ?? null,
    conversation.kind, conversation.id, conversation.threadId ?? null, sender]);
}

/** 只接受单个选项字母（大小写、全角均可），其余文本一律放行给后续中间件。 */
export function parseQuizLetter(raw: string | undefined): QuizLetter | undefined {
  const text = (raw ?? '').trim().replace(/[Ａ-Ｄａ-ｄ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  if (!/^[A-Da-d]$/u.test(text)) return undefined;
  return text.toUpperCase() as QuizLetter;
}

export function pickQuestion(bank: readonly QuizQuestion[], exceptId?: string): QuizQuestion {
  if (bank.length === 0) throw new Error('题库为空');
  if (bank.length === 1) return bank[0]!;
  let question = bank[randomInt(bank.length)]!;
  // 避免同一人连续两次抽到同一道题。
  if (question.id === exceptId) question = bank[(bank.indexOf(question) + 1 + randomInt(bank.length - 1)) % bank.length]!;
  return question;
}

export function formatQuestion(kind: QuizKind, question: QuizQuestion, timeoutSeconds: number, locale: Locale = 'zh-CN'): string {
  const head = messages(locale, kind);
  const options = question.options.map((option, index) => `${QUIZ_LETTERS[index]}. ${option}`);
  const letters = QUIZ_LETTERS.slice(0, question.options.length).join('/');
  return [`${head}【${question.category}】`, '', question.question, '', ...options, '',
    messages(locale, 'answer', { letters, seconds: timeoutSeconds })].join('\n');
}

export function formatJudgement(judgement: QuizJudgement): string {
  const { question, kind } = judgement.pending;
  const locale = resolveLocale(judgement.pending.locale);
  const answerText = `${question.answer}. ${question.options[QUIZ_LETTERS.indexOf(question.answer)]}`;
  const verdict = judgement.correct ? messages(locale, 'correct') : messages(locale, 'incorrect', { answer: answerText });
  const footer = kind === 'driving' ? messages(locale, 'drivingFooter') : '';
  return `${verdict}\n💡 ${question.explanation}${footer}`;
}

/** Generation-owned, in-memory only: pending questions vanish on reload, which is acceptable for a party game. */
export class QuizService {
  readonly #pending = new Map<string, PendingQuiz>();
  readonly #lastQuestion = new Map<string, string>();
  #disposed = false;

  ask(key: string, kind: QuizKind, bank: readonly QuizQuestion[], timeoutSeconds: number, now = Date.now(), locale: Locale = 'zh-CN'): QuizQuestion {
    this.#assertLive();
    this.sweep(now);
    const question = pickQuestion(bank, this.#lastQuestion.get(key));
    this.#pending.delete(key);
    this.#pending.set(key, { kind, question, locale, expiresAt: now + timeoutSeconds * 1000 });
    this.#lastQuestion.delete(key);
    this.#lastQuestion.set(key, question.id);
    while (this.#pending.size > MAX_PENDING_QUIZZES) this.#pending.delete(this.#pending.keys().next().value!);
    while (this.#lastQuestion.size > MAX_PENDING_QUIZZES) this.#lastQuestion.delete(this.#lastQuestion.keys().next().value!);
    return question;
  }

  peek(key: string, now = Date.now()): PendingQuiz | undefined {
    const pending = this.#pending.get(key);
    if (!pending) return undefined;
    if (pending.expiresAt <= now) {
      this.#pending.delete(key);
      return undefined;
    }
    return pending;
  }

  /** Judge and consume the pending question; letters beyond the option count are ignored (undefined). */
  answer(key: string, letter: QuizLetter, now = Date.now()): QuizJudgement | undefined {
    if (this.#disposed) return undefined;
    const pending = this.peek(key, now);
    if (!pending) return undefined;
    if (QUIZ_LETTERS.indexOf(letter) >= pending.question.options.length) return undefined;
    this.#pending.delete(key);
    return { correct: letter === pending.question.answer, chosen: letter, pending };
  }

  cancel(key: string): boolean {
    return this.#pending.delete(key);
  }

  sweep(now = Date.now()): void {
    for (const [key, pending] of this.#pending) if (pending.expiresAt <= now) this.#pending.delete(key);
  }

  get size(): number {
    return this.#pending.size;
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending.clear();
    this.#lastQuestion.clear();
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('答题服务属于已停止的插件实例');
  }
}
