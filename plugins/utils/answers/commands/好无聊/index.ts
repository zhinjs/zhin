import { defineCommand } from 'zhin.js/command';
import { resolveAnswersConfig, type AnswersConfig } from '../../src/config.js';
import { FUN_QUESTIONS } from '../../src/fun-quiz-data.js';
import { formatQuestion, quizKey } from '../../src/quiz.js';
import { quizServiceToken } from '../../src/runtime.js';

export default defineCommand<AnswersConfig>({
  description: '好无聊？来一道原创趣味选择题，直接回复字母作答',
  alias: ['boring'],
  execute({ input, use, config }) {
    const key = quizKey(input);
    if (!key) return '这个指令需要在真实会话里使用。';
    const settings = resolveAnswersConfig(config);
    const question = use(quizServiceToken).ask(key, 'fun', FUN_QUESTIONS, settings.quizTimeoutSeconds);
    return formatQuestion('fun', question, settings.quizTimeoutSeconds);
  },
});
