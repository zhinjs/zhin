/**
 * fork 模式：从主会话 active_leaf 链构建子 agent 上下文前导（过滤编排噪声）
 */
import {
  assistantText,
  type AgentMessage,
  type AssistantMessage,
  type ToolResultMessage,
} from '@zhin.js/ai';

const ORCHESTRATION_TOOLS = new Set(['spawn_task', 'tool_search', 'run_deferred_task']);
const DEFAULT_MAX_CHARS = 4096;
const DEFAULT_MAX_MESSAGES = 20;

type TextBlock = { type: string; text?: string };

function blocksToText(blocks: TextBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

function messageToLine(message: AgentMessage): string | null {
  if (message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult') {
    const blocks = (message as { content: TextBlock[] }).content;
    if (message.role === 'user') {
      const text = Array.isArray(blocks) ? blocksToText(blocks).trim() : '';
      return text ? `User: ${text}` : null;
    }
    if (message.role === 'assistant') {
      const text = assistantText(message as AssistantMessage).trim();
      return text ? `Assistant: ${text}` : null;
    }
    const tr = message as ToolResultMessage;
    if (ORCHESTRATION_TOOLS.has(tr.toolName)) return null;
    const text = Array.isArray(blocks) ? blocksToText(blocks) : '';
    const preview = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    return preview.trim() ? `Tool(${tr.toolName}): ${preview}` : null;
  }
  return null;
}

export function buildParentContextPreamble(
  messages: AgentMessage[],
  options?: { maxChars?: number; maxMessages?: number },
): string {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const maxMessages = options?.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const lines: string[] = [];
  let total = 0;
  for (const msg of messages.slice(-maxMessages)) {
    const line = messageToLine(msg);
    if (!line) continue;
    if (total + line.length + 1 > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n');
}
