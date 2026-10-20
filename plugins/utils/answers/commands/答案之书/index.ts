import { defineCommand } from 'zhin.js/command';
import { BOOK_USAGE, MAX_QUESTION_LENGTH, pickBookAnswer, replyBook } from '../../src/book.js';
import { resolveAnswersConfig, type AnswersConfig } from '../../src/config.js';

export default defineCommand<AnswersConfig>({
  description: '答案之书：心里默念问题，翻开一页得到答案',
  alias: ['answerbook'],
  params: { question: { type: 'text', optional: true, max: MAX_QUESTION_LENGTH, description: '你想问的问题' } },
  execute({ params, input, config }) {
    const question = typeof params.question === 'string' ? params.question.trim() : '';
    if (!question) return BOOK_USAGE;
    const settings = resolveAnswersConfig(config);
    const answer = pickBookAnswer({
      question,
      senderId: input?.sender?.id ?? 'anonymous',
      dailyStable: settings.dailyStable,
      timezone: settings.timezone,
    });
    return replyBook(question, answer);
  },
});
