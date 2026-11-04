import { messages } from '../../src/messages.js';
import { defineCommand } from 'zhin.js/command';
import { resolveAnswersConfig, type AnswersConfig } from '../../src/config.js';
import { FUN_QUESTIONS } from '../../src/fun-quiz-data.js';
import { formatQuestion, quizKey } from '../../src/quiz.js';
import { quizServiceToken } from '../../src/runtime.js';

export default defineCommand<AnswersConfig>({
  preferredAliasI18n: { en: 'boring' },
  description: '好无聊？来一道原创趣味选择题，直接回复字母作答', descriptionI18n: { en: "Try an original trivia question; reply with an option letter" },
  alias: ['boring'],
  execute({ input, use, config, locale }) {
    const key = quizKey(input);
    if (!key) return messages(locale, 'conversation');
    const settings = resolveAnswersConfig(config);
    const question = use(quizServiceToken).ask({ key: key, kind: 'fun', bank: FUN_QUESTIONS, timeoutSeconds: settings.quizTimeoutSeconds, now: Date.now(), locale: locale });
    return formatQuestion('fun', question, settings.quizTimeoutSeconds, locale);
  },
});
