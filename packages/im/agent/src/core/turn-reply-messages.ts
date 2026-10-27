import { createMessages } from '@zhin.js/plugin-runtime';

export const turnReplyMessages = createMessages({
  progress: {
    'zh-CN': '还在处理，已完成 {steps} 步，请稍候…',
    en: 'Still working. Completed {steps} steps; please wait…',
  },
  exhausted: {
    'zh-CN': '这一轮的处理步数已经用完，任务还没有完成。回复「继续」我会接着处理，或者把需求说得更具体一些再试。',
    en: 'This turn has used all its steps, and the task is not finished yet. Reply "continue" to keep going, or try again with a more specific request.',
  },
});
