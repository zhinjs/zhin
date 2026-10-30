import { createMessages } from '@zhin.js/plugin-runtime';

export const turnReplyMessages = createMessages({
  working: {
    'zh-CN': '正在分析已有结果，接下来确定并执行下一步。',
    en: 'Reviewing the available results, then deciding and carrying out the next step.',
  },
  waiting: {
    'zh-CN': '正在等待当前操作返回，之后会核对结果并继续剩余工作。',
    en: 'Waiting for the current operation to return, then checking its result and continuing the remaining work.',
  },
  stalled: {
    'zh-CN': '连续调用没有取得新结果，任务未完成，已暂停。请检查已有结果或补充信息。',
    en: 'Repeated calls made no progress. The task is unfinished and has stopped; please check the results or provide more information.',
  },
  progress: {
    'zh-CN': '还在处理，已完成 {steps} 步，请稍候…',
    en: 'Still working. Completed {steps} steps; please wait…',
  },
  exhausted: {
    'zh-CN': '这一轮的处理步数已经用完，任务还没有完成。回复「继续」我会接着处理，或者把需求说得更具体一些再试。',
    en: 'This turn has used all its steps, and the task is not finished yet. Reply "continue" to keep going, or try again with a more specific request.',
  },
});
