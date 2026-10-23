import { renderToPlainText, type OutputElement } from '@zhin.js/ai';
import type { Segment } from '@zhin.js/im-contract';

/** IM output belongs to Agent; the reusable AI engine stays transport-neutral. */
export type AgentOutputElement = OutputElement | {
  type: 'message';
  segments: Segment[];
};

/** Human-readable projection for logs, metrics and the already-told ledger. */
export function renderAgentOutput(output: readonly AgentOutputElement[]): string {
  return output.map(element => element.type === 'message'
    ? element.segments.map(segment => {
        if (segment.type === 'text') return String(segment.data.text);
        if (segment.type === 'markdown') return String(segment.data.content);
        if (segment.type === 'mention') return `@${segment.data.target}`;
        if (segment.type === 'reaction') return `[reaction ${String((segment.data as { emoji?: unknown }).emoji ?? '')}]`;
        return `[${segment.type}]`;
      }).join('')
    : renderToPlainText([element])).join('\n');
}

/**
 * Chat messages in send order: every `message` element starts its own message;
 * other elements (tool media, cards, text) join the message before them.
 */
export function splitOutputMessages(output: readonly AgentOutputElement[]): AgentOutputElement[][] {
  const messages: AgentOutputElement[][] = [];
  for (const element of output) {
    if (element.type === 'message' || messages.length === 0) messages.push([element]);
    else messages.at(-1)!.push(element);
  }
  return messages;
}
