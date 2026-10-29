import { createHash } from 'node:crypto';
import type { AgentMessage } from '../llm/types/agent-message.js';
import type { PromptContextState, TextContentBlock } from '../llm/types/content-block.js';
import { projectParticipantHeaders, type HeaderFormatOptions } from './participant-header.js';
import { trimFinishedToolResults } from './tool-result-trim.js';

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
export function projectPromptContext(messages: AgentMessage[], options?: HeaderFormatOptions): AgentMessage[] {
  return projectParticipantHeaders(trimFinishedToolResults(projectContextState(stripHistoricalTurnContext(messages))), options);
}

/** contextRef keys (or key prefixes ending in `:`) that only ever described one turn (ADR 0043 §1). */
const PER_TURN_CONTEXT_KEYS = [
  'deferred-tools', 'deferred-catalog-summary', 'workspace-rules', 'active-skills', 'quote-guidance',
  'session-guidance', 'session-identity', 'skill:', 'file-memory:', 'session-rules:',
];
/** Legacy unmarked text blocks: the per-turn envelope and its parts. */
const TURN_CONTEXT_BEGIN = '[Turn context]';
const TURN_CONTEXT_END = '[/Turn context]';
/** Tone hint, relevant memory, merged-turn and danmaku lines all live inside the `[Turn context]` block. */
const PER_TURN_TEXT_PREFIXES = [TURN_CONTEXT_BEGIN, '[Already told the user]'];

function isPerTurnContextKey(key: string): boolean {
  return PER_TURN_CONTEXT_KEYS.some(prefix => (prefix.endsWith(':') ? key.startsWith(prefix) : key === prefix));
}

function isPerTurnBlock(block: { type: string; text?: string; presentation?: string; perTurn?: unknown; ephemeral?: unknown; contextRef?: { key?: unknown } }): boolean {
  if (block.type !== 'text' || block.presentation === 'user-input') return false;
  if (block.perTurn === true || block.ephemeral === true) return true;
  const key = block.contextRef?.key;
  if (typeof key === 'string') return isPerTurnContextKey(key);
  const text = typeof block.text === 'string' ? block.text.trimStart() : '';
  return PER_TURN_TEXT_PREFIXES.some(prefix => text.startsWith(prefix));
}

/** Oldest legacy shape: the envelope was glued in front of the user text inside one block. */
function stripLeadingEnvelope(text: string): string | undefined {
  if (!text.startsWith(TURN_CONTEXT_BEGIN)) return undefined;
  const end = text.indexOf(TURN_CONTEXT_END);
  if (end < 0) return undefined;
  return text.slice(end + TURN_CONTEXT_END.length).replace(/^\s*\n/u, '');
}

/**
 * ADR 0043 §1: per-turn context belongs to the current message only. Every user message before the
 * current one (the last user message that still carries per-turn blocks) loses them — new history is
 * stored without them, so this mainly cleans rows stored before ADR 0043. Pure function of position;
 * stored history is never rewritten. Tool results are left alone (they are conversation).
 */
function stripHistoricalTurnContext(messages: AgentMessage[]): AgentMessage[] {
  const carries = (message: AgentMessage): boolean => message.role === 'user' && Array.isArray(message.content)
    && message.content.some(block => isPerTurnBlock(block as never)
      || (block.type === 'text' && typeof block.text === 'string' && stripLeadingEnvelope(block.text) !== undefined));
  let current = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (carries(messages[i]!)) { current = i; break; }
  }
  if (current <= 0) return messages;
  let changed = false;
  const out: AgentMessage[] = [];
  messages.forEach((message, index) => {
    if (index >= current || !carries(message)) { out.push(message); return; }
    const content = (message.content as Array<Record<string, unknown>>).flatMap(block => {
      if (block.type === 'text' && typeof block.text === 'string' && block.presentation !== 'user-input'
        && block.perTurn !== true && block.ephemeral !== true && !block.contextRef) {
        // Oldest shape: envelope and user text share one block; keep what follows the envelope.
        const rest = stripLeadingEnvelope(block.text);
        if (rest?.trim()) return [{ ...block, text: rest }];
      }
      return isPerTurnBlock(block as never) ? [] : [block];
    });
    changed = true;
    // Keep a now-empty user boundary (like repeated-block omission does): message indexes stay stable.
    out.push({ ...message, content } as AgentMessage);
  });
  return changed ? out : messages;
}

function projectContextState(messages: AgentMessage[]): AgentMessage[] {
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
