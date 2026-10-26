import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  conversation: { 'zh-CN': '这个指令需要在真实会话里使用。', en: 'Use this command in a chat conversation.' },
  disabled: { 'zh-CN': '当前未启用科目一小测（enableDrivingQuiz: false）。', en: 'The driving theory quiz is disabled (enableDrivingQuiz: false).' },
  fun: { 'zh-CN': '😴 好无聊？请听题！', en: '😴 Time for a trivia question! (Chinese question bank)' },
  driving: { 'zh-CN': '🚗 科目一小测，请听题！', en: '🚗 Chinese driving theory quiz (Chinese question bank)' },
  answer: { 'zh-CN': '直接回复 {letters} 作答，{seconds} 秒内有效。', en: 'Reply with {letters} within {seconds} seconds.' },
  correct: { 'zh-CN': '✅ 答对了！', en: '✅ Correct!' },
  incorrect: { 'zh-CN': '❌ 答错了，正确答案是 {answer}', en: '❌ Incorrect. The answer is {answer}' },
  drivingFooter: { 'zh-CN': '\n（原创题面，依据公开法规整理，仅供娱乐参考，以现行规定为准）', en: '\n(Original questions based on public Chinese traffic regulations; for entertainment and reference. Current regulations take precedence.)' },
  bookTitle: { 'zh-CN': '📖 答案之书', en: '📖 Book of Answers (Chinese answer collection)' },
  bookUsage: { 'zh-CN': '用法：{command} <问题>\n例如：{command} 今天要不要出去走走', en: 'Usage: {command} <question>\nExample: {command} Should I go for a walk today?' },
  bookIntro: { 'zh-CN': '心里默念问题后发送，书会翻开一页给你答案。', en: 'Think of your question and send it. The book will reveal an answer in Chinese.' },
  bookReply: { 'zh-CN': '📖 你问：{question}\n✨ 答案之书：{answer}', en: '📖 Your question: {question}\n✨ Book of Answers (Chinese): {answer}' },
});
