import { quizKey, QuizService } from '../src/quiz.js';

it('keeps a pending question in its exact temporary private conversation', () => {
  const source = (parent: string) => ({ conversation: { endpoint: { adapter: 'synthetic', id: 'account' },
    kind: 'private', id: 'alice', parent: { kind: 'group' as const, id: parent } }, sender: { id: 'alice' } });
  const first = quizKey(source('group-a'))!, other = quizKey(source('group-b'))!;
  expect(first).not.toBe(other);
  const service = new QuizService();
  const question = { id: 'synthetic', category: 'test', question: 'Synthetic?', options: ['A', 'B'], answer: 'A' as const, explanation: 'Synthetic' };
  service.ask({ key: first, kind: 'fun', bank: [question], timeoutSeconds: 60 });
  expect(service.answer(other, 'A')).toBeUndefined();
  expect(service.answer(first, 'A')?.correct).toBe(true);
});
