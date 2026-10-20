import { defineCommand } from 'zhin.js/command';
import { resolveAnswersConfig, type AnswersConfig } from '../../src/config.js';
import { DRIVING_QUESTIONS } from '../../src/driving-quiz-data.js';
import { formatQuestion, quizKey } from '../../src/quiz.js';
import { quizServiceToken } from '../../src/runtime.js';

export default defineCommand<AnswersConfig>({
  description: '科目一交规小测（原创题面，依据公开法规整理，仅供娱乐参考）',
  execute({ input, use, config }) {
    const settings = resolveAnswersConfig(config);
    if (!settings.enableDrivingQuiz) return '当前未启用科目一小测（enableDrivingQuiz: false）。';
    const key = quizKey(input);
    if (!key) return '这个指令需要在真实会话里使用。';
    const question = use(quizServiceToken).ask(key, 'driving', DRIVING_QUESTIONS, settings.quizTimeoutSeconds);
    return formatQuestion('driving', question, settings.quizTimeoutSeconds);
  },
});
