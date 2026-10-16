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
        return `[${segment.type}]`;
      }).join('')
    : renderToPlainText([element])).join('\n');
}
