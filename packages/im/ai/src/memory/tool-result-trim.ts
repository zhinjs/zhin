import type { AgentMessage } from '../llm/types/agent-message.js';

/** ADR 0043 §3: how much of a finished turn's tool result (and long call argument) the model still sees. */
export const FINISHED_TOOL_RESULT_KEEP_CHARS = 200;

/** Marker appended where text was cut; N counts the omitted characters. */
export function omittedMarker(omitted: number): string {
  return `…(已省略 ${omitted} 字)`;
}

/** Index where the last turn starts: the first user message of the final run of user messages. */
export function lastTurnStart(messages: readonly AgentMessage[]): number {
  let i = messages.length - 1;
  while (i >= 0 && messages[i]!.role !== 'user') i--;
  if (i < 0) return messages.length;
  while (i > 0 && messages[i - 1]!.role === 'user') i--;
  return i;
}

function trimString(text: string): string {
  return text.length <= FINISHED_TOOL_RESULT_KEEP_CHARS
    ? text
    : `${text.slice(0, FINISHED_TOOL_RESULT_KEEP_CHARS)}${omittedMarker(text.length - FINISHED_TOOL_RESULT_KEEP_CHARS)}`;
}

type Block = { type: string; text?: string; contextRef?: unknown };

/** Keep the first 200 chars of text across blocks; non-text blocks and provenance-marked blocks stay. */
function trimResultBlocks(content: Block[]): Block[] | undefined {
  const total = content.reduce((sum, b) => sum + (b.type === 'text' && typeof b.text === 'string' && !b.contextRef ? b.text.length : 0), 0);
  if (total <= FINISHED_TOOL_RESULT_KEEP_CHARS) return undefined;
  let remaining = FINISHED_TOOL_RESULT_KEEP_CHARS;
  let omitted = 0;
  let lastKept = -1;
  const out: Block[] = [];
  content.forEach(block => {
    if (block.type !== 'text' || typeof block.text !== 'string' || block.contextRef) { out.push(block); return; }
    if (remaining >= block.text.length) {
      remaining -= block.text.length;
      out.push(block);
      lastKept = out.length - 1;
      return;
    }
    omitted += block.text.length - remaining;
    if (remaining > 0) {
      out.push({ ...block, text: block.text.slice(0, remaining) });
      lastKept = out.length - 1;
      remaining = 0;
    }
  });
  const marker = omittedMarker(omitted);
  if (lastKept >= 0) out[lastKept] = { ...out[lastKept]!, text: `${out[lastKept]!.text}${marker}` };
  else out.unshift({ type: 'text', text: marker });
  return out;
}

function trimArguments(args: Record<string, unknown>): Record<string, unknown> | undefined {
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > FINISHED_TOOL_RESULT_KEEP_CHARS) {
      out[key] = trimString(value);
      changed = true;
    } else out[key] = value;
  }
  return changed ? out : undefined;
}

/**
 * ADR 0043 §3: tool results (and very long call arguments) of finished turns keep only their head.
 * A result is trimmed once its turn is over, i.e. it lies before the last turn and the model has
 * answered after it. A pure function of position, so a given result is cut the same way on every
 * later request. `isError`, tool names and call ids are kept; stored history is never edited.
 */
export function trimFinishedToolResults(messages: AgentMessage[]): AgentMessage[] {
  const current = lastTurnStart(messages);
  if (current <= 0) return messages;
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'assistant') { lastAssistant = i; break; }
  let changed = false;
  const out = messages.map((message, index) => {
    if (index >= current || index >= lastAssistant) return message;
    if (message.role === 'toolResult' && Array.isArray(message.content)) {
      const content = trimResultBlocks(message.content as Block[]);
      if (!content) return message;
      changed = true;
      return { ...message, content } as AgentMessage;
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      let touched = false;
      const content = message.content.map(block => {
        if (block.type !== 'toolCall' || block.inputError) return block;
        const args = trimArguments(block.arguments);
        if (!args) return block;
        touched = true;
        return { ...block, arguments: args };
      });
      if (!touched) return message;
      changed = true;
      return { ...message, content } as AgentMessage;
    }
    return message;
  });
  return changed ? out : messages;
}
