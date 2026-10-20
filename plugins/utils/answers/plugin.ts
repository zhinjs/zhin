import { definePlugin } from 'zhin.js';
import type { AnswersConfig } from './src/config.js';
import { QuizService } from './src/quiz.js';
import { quizServiceToken } from './src/runtime.js';

/**
 * Plugin Runtime:
 * - `commands/` 提供 答案之书 / 好无聊 / 科目一；
 * - `middlewares/quiz-answer` 只接管「有待答题目的同一发送者」回复的单个选项字母；
 * - 题目状态仅在内存中保存，随插件代际销毁。
 */
export default definePlugin<AnswersConfig>({
  name: 'answers',
  metadata: {
    displayName: '答案之书',
  },
  setup(context) {
    const service = new QuizService();
    context.resources.provide(quizServiceToken, service);
    return () => service.dispose();
  },
});
