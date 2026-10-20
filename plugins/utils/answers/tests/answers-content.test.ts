import { describe, expect, it } from 'vitest';
import { BOOK_ANSWERS } from '../src/book-data.js';
import { DRIVING_QUESTIONS } from '../src/driving-quiz-data.js';
import { FUN_QUESTIONS } from '../src/fun-quiz-data.js';
import { QUIZ_LETTERS, type QuizQuestion } from '../src/quiz-types.js';

function assertBank(bank: readonly QuizQuestion[], prefix: string) {
  const ids = new Set<string>();
  for (const question of bank) {
    expect(question.id.startsWith(prefix)).toBe(true);
    expect(ids.has(question.id)).toBe(false);
    ids.add(question.id);
    expect(question.question.trim().length).toBeGreaterThan(4);
    expect(question.options.length).toBeGreaterThanOrEqual(2);
    expect(question.options.length).toBeLessThanOrEqual(4);
    expect(new Set(question.options).size).toBe(question.options.length);
    expect(QUIZ_LETTERS.indexOf(question.answer)).toBeLessThan(question.options.length);
    expect(question.explanation.trim().length).toBeGreaterThan(4);
    for (const option of question.options) expect(option).not.toMatch(/^[A-D][.、]/u);
  }
}

describe('original content banks', () => {
  it('ships a non-trivial, duplicate-free answer book', () => {
    expect(BOOK_ANSWERS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BOOK_ANSWERS).size).toBe(BOOK_ANSWERS.length);
    for (const answer of BOOK_ANSWERS) expect(answer.length).toBeLessThanOrEqual(40);
  });

  it('keeps every fun question well-formed', () => {
    expect(FUN_QUESTIONS.length).toBeGreaterThanOrEqual(30);
    assertBank(FUN_QUESTIONS, 'fun-');
  });

  it('keeps every driving question well-formed and grounded in a cited rule', () => {
    expect(DRIVING_QUESTIONS.length).toBeGreaterThanOrEqual(20);
    assertBank(DRIVING_QUESTIONS, 'drv-');
    for (const question of DRIVING_QUESTIONS) expect(question.explanation).toMatch(/道交法|实施条例|国家标准|记分周期|有效期/u);
  });

  it('spreads correct answers across letters instead of always using one', () => {
    const letters = new Set([...FUN_QUESTIONS, ...DRIVING_QUESTIONS].map((question) => question.answer));
    expect(letters.size).toBeGreaterThanOrEqual(3);
  });
});
