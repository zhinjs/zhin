import { defineCommand } from 'zhin.js/command';
import { bookUsage, MAX_QUESTION_LENGTH, pickBookAnswer, replyBook } from '../../src/book.js';
import { resolveAnswersConfig, type AnswersConfig } from '../../src/config.js';

export default defineCommand<AnswersConfig>({
  preferredAliasI18n: { en: 'answerbook' },
  description: '答案之书：心里默念问题，翻开一页得到答案', descriptionI18n: { en: "Book of Answers: think of a question and turn a page" },
  alias: ['answerbook'],
  params: { question: { type: 'text', optional: true, max: MAX_QUESTION_LENGTH, description: '你想问的问题', descriptionI18n: { en: "Your question" } } },
  execute({ params, input, config, locale, formatCommand }) {
    const question = typeof params.question === 'string' ? params.question.trim() : '';
    if (!question) return bookUsage(locale, formatCommand('答案之书'));
    const settings = resolveAnswersConfig(config);
    const answer = pickBookAnswer({
      question,
      senderId: input?.sender?.id ?? 'anonymous',
      dailyStable: settings.dailyStable,
      timezone: settings.timezone,
    });
    return replyBook(question, answer, locale);
  },
});
