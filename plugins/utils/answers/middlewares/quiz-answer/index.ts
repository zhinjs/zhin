import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from '@zhin.js/core/runtime';
import { formatJudgement, parseQuizLetter, quizKey } from '../../src/quiz.js';
import { quizServiceToken } from '../../src/runtime.js';

/**
 * 只在「发送者本人在本会话有未过期题目」且消息恰好是一个选项字母时接管；
 * 其他消息（包括别人回复的字母）全部交给后续中间件，避免劫持普通聊天。
 */
export default defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    const letter = parseQuizLetter(context.input.content);
    const key = letter ? quizKey(context.input) : undefined;
    const judgement = letter && key ? context.use(quizServiceToken).answer(key, letter) : undefined;
    if (!judgement) {
      await next();
      return;
    }
    await context.input.$reply(formatJudgement(judgement));
  },
});
