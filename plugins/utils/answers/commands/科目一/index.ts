import { messages } from '../../src/messages.js';
import { defineCommand } from 'zhin.js/command';
import { resolveAnswersConfig, type AnswersConfig } from '../../src/config.js';
import { DRIVING_QUESTIONS } from '../../src/driving-quiz-data.js';
import { formatQuestion, quizKey } from '../../src/quiz.js';
import { quizServiceToken } from '../../src/runtime.js';

export default defineCommand<AnswersConfig>({
  alias: ['driving-quiz'],
  preferredAliasI18n: { en: 'driving-quiz' },
  description: '科目一交规小测（原创题面，依据公开法规整理，仅供娱乐参考）', descriptionI18n: { en: "Chinese driving theory quiz with original questions; for entertainment and reference only" },
  execute({ input, use, config, locale }) {
    const settings = resolveAnswersConfig(config);
    if (!settings.enableDrivingQuiz) return messages(locale, 'disabled');
    const key = quizKey(input);
    if (!key) return messages(locale, 'conversation');
    const question = use(quizServiceToken).ask(key, 'driving', DRIVING_QUESTIONS, settings.quizTimeoutSeconds, Date.now(), locale);
    return formatQuestion('driving', question, settings.quizTimeoutSeconds, locale);
  },
});
