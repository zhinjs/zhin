import { defineCommand } from 'zhin.js/command';
import { bookUsage, MAX_QUESTION_LENGTH, pickBookAnswer, replyBook } from '../../src/book.js';
import type { AnswersConfig } from '../../src/config.js';
import { answersSettingsFor } from '../../src/runtime.js';

export default defineCommand<AnswersConfig>({
  preferredAliasI18n: { en: 'answerbook' },
  description: '答案之书：心里默念问题，翻开一页得到答案', descriptionI18n: { en: "Book of Answers: think of a question and turn a page" },
  alias: ['answerbook'],
  params: { question: { type: 'text', optional: true, max: MAX_QUESTION_LENGTH, description: '你想问的问题', descriptionI18n: { en: "Your question" } } },
  execute(context) {
    const { params, input, locale, formatCommand } = context;
    const question = typeof params.question === 'string' ? params.question.trim() : '';
    if (!question) return bookUsage(locale, formatCommand('答案之书'));
    const settings = answersSettingsFor(context);
    const answer = pickBookAnswer({
      question,
      senderId: input?.sender?.id ?? 'anonymous',
      dailyStable: settings.dailyStable,
      timezone: settings.timezone,
    });
    return replyBook(question, answer, locale);
  },
});
