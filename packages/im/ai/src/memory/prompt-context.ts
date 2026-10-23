import { createHash } from 'node:crypto';
import type { AgentMessage } from '../llm/types/agent-message.js';
import type { TextContentBlock } from '../llm/types/content-block.js';

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Only the runtime that injected the block may mark its provenance. */
export function createPromptContextBlock(key: string, text: string): TextContentBlock {
  const labelled = `[Context source: ${key}]\n${text}`;
  return { type: 'text', text: labelled, contextRef: { key, digest: digest(labelled) } };
}

/**
 * An append-stable model view: keep the first full version, reference identical
 * repetitions, and emit changed versions in place. Never edit stored history.
 * Each call starts with the available prefix, so tail loads/compaction/branches
 * cannot leave dangling references. A → B → A emits all three versions.
 */
export function projectPromptContext(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Map<string, string>();
  let changed = false;
  const out = messages.map(message => {
    if ((message.role !== 'user' && message.role !== 'toolResult')
      || ('isError' in message && message.isError === true) || !Array.isArray(message.content)) return message;
    let messageChanged = false;
    const content = message.content.map(block => {
      if (block.type !== 'text' || typeof block.text !== 'string') return block;
      const ref = block.contextRef;
      if (!ref || typeof ref.key !== 'string' || !ref.key || ref.digest !== digest(block.text)) return block;
      const repeated = seen.get(ref.key) === ref.digest;
      seen.set(ref.key, ref.digest);
      if (!repeated) return block;
      messageChanged = true;
      // A short reference keeps current applicability visible without copying the body.
      return { type: 'text' as const, text: `[Unchanged context: ${ref.key}]` };
    });
    if (!messageChanged) return message;
    changed = true;
    return { ...message, content } as AgentMessage;
  });
  return changed ? out : messages;
}
