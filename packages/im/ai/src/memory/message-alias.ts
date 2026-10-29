/**
 * ADR 0043 §5 message aliases.
 *
 * Platform message ids are 20-30 chars; the model sees short aliases `m<n>` instead. `n` is the
 * message's ordinal among the session's messages that carry a platform message id, counted over the
 * active path of the STORED history (not the visible window), so:
 *  - an alias never changes once assigned (messages are only ever appended);
 *  - already-sent prefixes keep their bytes when the window slides or the history is compacted;
 *  - nothing new is stored: the repository derives the ordinal when it loads rows
 *    ({@link assignRowAliasSeqs}) and in-turn messages continue the count.
 */
import type { AgentMessage } from '../llm/types/agent-message.js';

const ALIAS = /^m([1-9]\d{0,8})$/u;

export function isMessageAlias(value: string): boolean {
  return ALIAS.test(value);
}

export function messageAliasOf(seq: number): string {
  return `m${seq}`;
}

function platformIdOf(message: AgentMessage): string | undefined {
  if (message.role !== 'user' && message.role !== 'assistant') return undefined;
  const id = (message as { messageId?: unknown }).messageId;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

/** Alias lookup over one message sequence (oldest first). */
export interface MessageAliasIndex {
  /** Alias of a platform message id, if that message is in the sequence. */
  aliasOf(platformId: string): string | undefined;
  /** Platform id behind an alias. */
  idOf(alias: string): string | undefined;
}

export interface MessageAliasAssignment extends MessageAliasIndex {
  /** Alias per message object (only messages that carry a platform id). */
  readonly aliases: ReadonlyMap<AgentMessage, string>;
}

export function indexMessageAliases(messages: readonly AgentMessage[], known?: MessageAliasIndex): MessageAliasAssignment {
  const byId = new Map<string, string>();
  const byAlias = new Map<string, string>();
  const aliases = new Map<AgentMessage, string>();
  let counter = 0;
  for (const message of messages) {
    const id = platformIdOf(message);
    if (!id) continue;
    let alias = byId.get(id) ?? known?.aliasOf(id);
    if (!alias) {
      const stored = (message as { aliasSeq?: unknown }).aliasSeq;
      const seq = typeof stored === 'number' && Number.isInteger(stored) && stored > counter ? stored : counter + 1;
      counter = seq;
      alias = messageAliasOf(seq);
    } else {
      counter = Math.max(counter, Number(ALIAS.exec(alias)?.[1] ?? 0));
    }
    byId.set(id, alias);
    byAlias.set(alias, id);
    aliases.set(message, alias);
  }
  return { aliases, aliasOf: id => byId.get(id), idOf: alias => byAlias.get(alias) };
}

/**
 * Per-turn alias <-> platform id map for tools. It accumulates every projection the turn performs,
 * so an alias the model saw in any request resolves later in the same turn.
 */
export class MessageAliasTable implements MessageAliasIndex {
  readonly #byId = new Map<string, string>();
  readonly #byAlias = new Map<string, string>();

  index(messages: readonly AgentMessage[]): void {
    const next = indexMessageAliases(messages, this);
    for (const alias of next.aliases.values()) {
      const id = next.idOf(alias);
      if (!id) continue;
      this.#byId.set(id, alias);
      this.#byAlias.set(alias, id);
    }
  }

  aliasOf(platformId: string): string | undefined {
    return this.#byId.get(platformId);
  }

  idOf(alias: string): string | undefined {
    return this.#byAlias.get(alias);
  }

  /** The platform id for an alias, or the input unchanged (platform ids and unknown values pass through). */
  resolve(aliasOrId: string): string {
    return this.#byAlias.get(aliasOrId.trim()) ?? aliasOrId;
  }
}

const ID_ARGUMENT = /^(?:reference|.*message_?ids?)$/iu;

/**
 * Tool arguments that name a message (`message_id`, `message_ids`, `quote_message_id`, `messageId`,
 * and `reference` of `inspect_conversation_reference`) may carry an alias; they are rewritten to the
 * platform id before the tool runs, so tools never need to know about aliases. Unknown values pass through.
 */
export function resolveMessageAliasArguments<T>(input: T, table: Pick<MessageAliasTable, 'resolve'>, depth = 0): T {
  if (depth > 3 || !input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(item => resolveMessageAliasArguments(item, table, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (ID_ARGUMENT.test(key)) {
      if (typeof value === 'string') { out[key] = table.resolve(value); continue; }
      if (Array.isArray(value)) { out[key] = value.map(item => typeof item === 'string' ? table.resolve(item) : item); continue; }
    }
    out[key] = resolveMessageAliasArguments(value, table, depth + 1);
  }
  return out as T;
}

/** Platform message id of a stored payload without parsing it (row scans over long histories). */
export function payloadMessageId(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    const hit = /"messageId":"((?:[^"\\]|\\.)*)"/u.exec(payload);
    if (!hit) return undefined;
    try { return (JSON.parse(`"${hit[1]}"`) as string) || undefined; } catch { return hit[1] || undefined; }
  }
  const id = payload && typeof payload === 'object' ? (payload as { messageId?: unknown }).messageId : undefined;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * Session ordinal per stored row, over the whole active path (oldest first): the n-th distinct platform
 * id gets `n`. Rows without an id are absent; a repeated id reuses the first occurrence's number.
 */
export function assignRowAliasSeqs<T extends { payload: unknown }>(pathRows: readonly T[]): Map<T, number> {
  const seqById = new Map<string, number>();
  const out = new Map<T, number>();
  for (const row of pathRows) {
    const id = payloadMessageId(row.payload);
    if (!id) continue;
    let seq = seqById.get(id);
    if (seq === undefined) {
      seq = seqById.size + 1;
      seqById.set(id, seq);
    }
    out.set(row, seq);
  }
  return out;
}
