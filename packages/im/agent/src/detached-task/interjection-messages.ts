import { createMessages } from '@zhin.js/plugin-runtime';

export const taskMessages = createMessages({
  queued: { 'zh-CN': '排队中', en: 'Queued' }, running: { 'zh-CN': '运行中', en: 'Running' },
  waiting_approval: { 'zh-CN': '等待确认', en: 'Waiting for approval' }, paused: { 'zh-CN': '已暂停', en: 'Paused' },
  done: { 'zh-CN': '已完成', en: 'Completed' }, failed: { 'zh-CN': '失败', en: 'Failed' }, cancelled: { 'zh-CN': '已取消', en: 'Cancelled' },
  stopped: { 'zh-CN': '已停止后台任务 {id}。', en: 'Stopped background task {id}.' },
  stoppedReply: { 'zh-CN': '好的，已停止后台任务 {id}。', en: 'OK, stopped background task {id}.' },
  redirected: { 'zh-CN': '收到，后台任务 {id} 会在下一步按新要求调整。', en: 'Background task {id} will follow the new instructions at the next step.' },
  empty: { 'zh-CN': '本会话没有后台任务。', en: 'This session has no background tasks.' },
  line: { 'zh-CN': '- {id}｜{status}｜{steps} 步｜{goal}', en: '- {id} | {status} | {steps} steps | {goal}' },
  active: { 'zh-CN': '进行中的后台任务：', en: 'Active background tasks:' },
  inactive: { 'zh-CN': '没有进行中的后台任务。', en: 'No active background tasks.' },
  recent: { 'zh-CN': '最近结束：', en: 'Recently finished:' },
  usage: { 'zh-CN': '用法：{tasks}、{task} stop <id>、{task} redirect <id> <新要求>', en: 'Usage: {tasks}, {task} stop <id>, {task} redirect <id> <instructions>' },
  stopUsage: { 'zh-CN': '用法：{task} stop <id>', en: 'Usage: {task} stop <id>' },
  redirectUsage: { 'zh-CN': '用法：{task} redirect <id> <新要求>', en: 'Usage: {task} redirect <id> <instructions>' },
  notFound: { 'zh-CN': '找不到可操作的后台任务 {id}。', en: 'No controllable background task found for {id}.' },
  terminal: { 'zh-CN': '后台任务 {id} 当前状态：{status}，无法操作。', en: 'Background task {id} is {status}; it cannot be controlled.' },
});
