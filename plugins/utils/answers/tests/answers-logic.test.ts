import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../schema.json' with { type: 'json' };
import { calendarDay, normalizeQuestion, pickBookAnswer, replyBook } from '../src/book.js';
import { DEFAULT_ANSWERS_CONFIG, resolveAnswersConfig } from '../src/config.js';
import { FUN_QUESTIONS } from '../src/fun-quiz-data.js';
import { MAX_PENDING_QUIZZES, QuizService, formatJudgement, formatQuestion, parseQuizLetter, pickQuestion, quizKey } from '../src/quiz.js';
import type { QuizQuestion } from '../src/quiz-types.js';

const conversation = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'group', id: 'g1' } as const;
const bank: readonly QuizQuestion[] = [
  { id: 't-1', category: '测试', question: '一加一等于几？', options: ['1', '2', '3'], answer: 'B', explanation: '一加一等于二。' },
  { id: 't-2', category: '测试', question: '二加二等于几？', options: ['4', '5'], answer: 'A', explanation: '二加二等于四。' },
];

describe('configuration', () => {
  it('validates and defaults the schema exposed to Console', () => {
    const ajv = new Ajv2020({ useDefaults: true, strict: true });
    ajv.addKeyword({ keyword: 'x-zhin-config', schemaType: 'object' });
    ajv.addKeyword({ keyword: 'x-i18n', schemaType: 'object' });
    const validate = ajv.compile(schema);
    const empty = {};
    expect(validate(empty)).toBe(true);
    expect(empty).toEqual(DEFAULT_ANSWERS_CONFIG);
    expect(validate({ quizTimeoutSeconds: 5 })).toBe(false);
    expect(validate({ quizTimeoutSeconds: 30.5 })).toBe(false);
    expect(validate({ dailyStable: 'yes' })).toBe(false);
    expect(validate({ unknown: true })).toBe(false);
    expect(resolveAnswersConfig(undefined)).toEqual(DEFAULT_ANSWERS_CONFIG);
    expect(resolveAnswersConfig({ dailyStable: true }).dailyStable).toBe(true);
  });
});

describe('answer book', () => {
  const answers = ['甲', '乙', '丙', '丁', '戊', '己', '庚'];

  it('normalizes punctuation and whitespace', () => {
    expect(normalizeQuestion(' 要不要 出门？ ')).toBe(normalizeQuestion('要不要出门?'));
  });

  it('is stable per user, question and calendar day when dailyStable is on', () => {
    const base = { question: '今天要不要出门？', senderId: 'alice', dailyStable: true, timezone: 'Asia/Shanghai', now: Date.UTC(2026, 9, 20, 2) };
    const first = pickBookAnswer(base, answers);
    expect(pickBookAnswer({ ...base, question: '今天要不要出门?', now: base.now + 3_600_000 }, answers)).toBe(first);
    const outcomes = new Set<string>();
    for (let day = 0; day < 30; day++) outcomes.add(pickBookAnswer({ ...base, now: base.now + day * 86_400_000 }, answers));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('uses the configured timezone for the day boundary and survives invalid zones', () => {
    const now = Date.UTC(2026, 9, 20, 17);
    expect(calendarDay(now, 'Asia/Shanghai')).toBe('2026-10-21');
    expect(calendarDay(now, 'UTC')).toBe('2026-10-20');
    expect(calendarDay(now, 'Not/AZone')).toBe('2026-10-20');
  });

  it('returns a listed answer when random', () => {
    for (let i = 0; i < 20; i++) expect(answers).toContain(pickBookAnswer({ question: 'x', senderId: 'a', dailyStable: false, timezone: 'UTC' }, answers));
    expect(() => pickBookAnswer({ question: 'x', senderId: 'a', dailyStable: false, timezone: 'UTC' }, [])).toThrow('答案之书为空');
    expect(replyBook('问', '答')).toContain('✨ 答案之书：答');
  });
});

describe('quiz helpers', () => {
  it('scopes keys by conversation and sender and refuses anonymous input', () => {
    const alice = quizKey({ conversation, sender: { id: 'alice' } });
    expect(alice).toBeDefined();
    expect(quizKey({ conversation, sender: { id: 'bob' } })).not.toBe(alice);
    expect(quizKey({ conversation: { ...conversation, id: 'g2' }, sender: { id: 'alice' } })).not.toBe(alice);
    expect(quizKey({ conversation, sender: 'alice' })).toBe(alice);
    expect(quizKey({ conversation })).toBeUndefined();
    expect(quizKey(undefined)).toBeUndefined();
  });

  it.each([['a', 'A'], [' B ', 'B'], ['ｃ', 'C'], ['Ｄ', 'D']])('parses %s as a letter', (raw, letter) => {
    expect(parseQuizLetter(raw)).toBe(letter);
  });

  it.each(['', 'E', 'AB', '选A', 'a.', 'hello', undefined])('ignores %s', (raw) => {
    expect(parseQuizLetter(raw)).toBeUndefined();
  });

  it('avoids repeating the previous question', () => {
    for (let i = 0; i < 20; i++) expect(pickQuestion(bank, 't-1').id).toBe('t-2');
    expect(pickQuestion([bank[0]!], 't-1').id).toBe('t-1');
    expect(() => pickQuestion([])).toThrow('题库为空');
  });

  it('formats questions and verdicts', () => {
    const text = formatQuestion('fun', bank[0]!, 60);
    expect(text).toContain('A. 1\nB. 2\nC. 3');
    expect(text).toContain('直接回复 A/B/C 作答，60 秒内有效');
    const pending = { kind: 'driving' as const, question: bank[0]!, expiresAt: 0 };
    expect(formatJudgement({ correct: true, chosen: 'B', pending })).toContain('✅ 答对了');
    const wrong = formatJudgement({ correct: false, chosen: 'A', pending });
    expect(wrong).toContain('正确答案是 B. 2');
    expect(wrong).toContain('仅供娱乐参考');
  });
});

describe('QuizService', () => {
  it('judges once, ignores out-of-range letters and expires stale questions', () => {
    const service = new QuizService();
    const question = service.ask({ key: 'k', kind: 'fun', bank: [bank[1]!], timeoutSeconds: 30, now: 1000 });
    expect(question.id).toBe('t-2');
    expect(service.answer('k', 'C', 2000)).toBeUndefined();
    expect(service.answer('k', 'A', 2000)).toMatchObject({ correct: true, chosen: 'A' });
    expect(service.answer('k', 'A', 2000)).toBeUndefined();
    service.ask({ key: 'k', kind: 'fun', bank: [bank[1]!], timeoutSeconds: 30, now: 1000 });
    expect(service.answer('k', 'B', 31_000)).toBeUndefined();
    expect(service.size).toBe(0);
  });

  it('bounds memory and refuses work after dispose', () => {
    const service = new QuizService();
    for (let i = 0; i <= MAX_PENDING_QUIZZES; i++) service.ask({ key: `k${i}`, kind: 'fun', bank: FUN_QUESTIONS, timeoutSeconds: 60, now: 0 });
    expect(service.size).toBe(MAX_PENDING_QUIZZES);
    expect(service.peek('k0', 0)).toBeUndefined();
    expect(service.cancel(`k${MAX_PENDING_QUIZZES}`)).toBe(true);
    service.dispose();
    expect(service.size).toBe(0);
    expect(service.answer('k1', 'A', 0)).toBeUndefined();
    expect(() => service.ask({ key: 'k', kind: 'fun', bank: FUN_QUESTIONS, timeoutSeconds: 60 })).toThrow('已停止');
  });
});
