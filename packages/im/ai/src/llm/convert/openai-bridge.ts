import type { AssistantMessage } from '../types/agent-message.js';

/** assistant 消息的文本视图（无文本时回退 thinking 拼接）。 */
export function assistantText(message: AssistantMessage): string {
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (text.trim()) return text;
  const hasToolCalls = message.content.some((b) => b.type === 'toolCall');
  if (hasToolCalls) return text;
  return message.content
    .filter((b): b is Extract<typeof b, { type: 'thinking' }> => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('');
}
