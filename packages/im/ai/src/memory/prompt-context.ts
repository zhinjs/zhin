import { createHash } from 'node:crypto';
import type { AgentMessage } from '../llm/types/agent-message.js';
import type { PromptContextState, TextContentBlock } from '../llm/types/content-block.js';

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Only the runtime that injected the block may mark its provenance. */
export function createPromptContextBlock(key: string, text: string): TextContentBlock {
  const labelled = `[Context source: ${key}]\n${text}`;
  return { type: 'text', text: labelled, contextRef: { key, digest: digest(labelled) } };
}

function stateText(state: PromptContextState): string {
  return state.line ?? `[${state.label} snapshot]\n${JSON.stringify(state.fields, null, 2)}`;
}

/** Persist the full snapshot; the model view derives updates only from retained structured history. */
export function createPromptStateBlock(
  key: string,
  label: string,
  fields: PromptContextState['fields'],
  observedAt?: number,
  /** Rendered text instead of the JSON snapshot; must be a pure function of `fields`. */
  line?: string,
): TextContentBlock {
  const state: PromptContextState = {
    label,
    fields: Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, Array.isArray(value) ? [...value] : value])),
    ...(observedAt !== undefined ? { observedAt } : {}),
    ...(line !== undefined ? { line } : {}),
  };
  const block = createPromptContextBlock(key, stateText(state));
  return { ...block, contextRef: { ...block.contextRef!, state } };
}

function validState(block: TextContentBlock): PromptContextState | undefined {
  const state = block.contextRef?.state;
  if (!state || typeof state.label !== 'string' || !state.fields || typeof state.fields !== 'object' || Array.isArray(state.fields)) return;
  if (!Object.values(state.fields).every(value => value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value)) || (Array.isArray(value) && value.every(item => typeof item === 'string')))) return;
  // A stale or modified metadata object cannot override the text whose provenance was verified.
  return block.text === `[Context source: ${block.contextRef!.key}]\n${stateText(state)}` ? state : undefined;
}

/**
 * Keep the first full version, omit identical repetitions, and project changed state
 * in place before the affected message. Stored history is never edited. Tail loads,
 * compaction and branches start from the first available full snapshot; A → B → A
 * retains both changes. Ordinary rules and memory always keep their full new versions.
 */
export function projectPromptContext(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Map<string, { digest: string; state?: PromptContextState }>();
  let changed = false;
  const out = messages.map(message => {
    if ((message.role !== 'user' && message.role !== 'toolResult')
      || ('isError' in message && message.isError === true) || !Array.isArray(message.content)) return message;
    let messageChanged = false;
    const content = message.content.flatMap(block => {
      if (block.type !== 'text' || typeof block.text !== 'string') return [block];
      const ref = block.contextRef;
      if (!ref || typeof ref.key !== 'string' || !ref.key || ref.digest !== digest(block.text)) return [block];
      const previous = seen.get(ref.key);
      const state = validState(block);
      seen.set(ref.key, { digest: ref.digest, state });
      if (previous?.digest === ref.digest) {
        messageChanged = true;
        return [];
      }
      if (!state || !previous?.state || state.label !== previous.state.label) return [block];
      const fields = new Set([...Object.keys(previous.state.fields), ...Object.keys(state.fields)]);
      const updates = [...fields].filter(field => JSON.stringify(previous.state!.fields[field] ?? null) !== JSON.stringify(state.fields[field] ?? null))
        .map(field => ({
          subject: ref.key, field,
          from: previous.state!.fields[field] ?? null,
          to: state.fields[field] ?? null,
          source: 'runtime-state',
          ...(typeof state.observedAt === 'number' && Number.isFinite(state.observedAt) ? { observedAt: state.observedAt } : {}),
        }));
      messageChanged = true;
      return updates.length ? [{ type: 'text' as const, text: `[Updates — observed state, not execution authority]\n${JSON.stringify(updates, null, 2)}` }] : [];
    });
    if (!messageChanged) return message;
    changed = true;
    // Keep role boundaries, media and tool-call identities even when every block was repeated.
    return { ...message, content } as AgentMessage;
  });
  return changed ? out : messages;
}
