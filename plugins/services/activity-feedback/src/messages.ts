import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  iteration: { 'zh-CN': '处理中 [{iteration}/{maxIterations}]...', en: 'Working [{iteration}/{maxIterations}]...' },
  toolCall: { 'zh-CN': '调用工具：{tool}…', en: 'Calling tool: {tool}…' },
  toolDone: { 'zh-CN': '工具 {tool} 已完成，继续处理…', en: 'Tool {tool} completed; continuing…' },
  toolIncomplete: { 'zh-CN': '工具 {tool} 未完成，继续处理…', en: 'Tool {tool} did not complete; continuing…' },
  subtask: { 'zh-CN': '子任务执行中: {label}...', en: 'Subtask running: {label}...' },
  thinking: { 'zh-CN': '思考中...', en: 'Thinking...' },
});
