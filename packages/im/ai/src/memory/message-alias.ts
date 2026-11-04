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
 * A multi-message reply keeps its first known id at `m<n>` and gives subsequent physical messages
 * `m<n>.2`, `m<n>.3`, ... without consuming another row's ordinal. Every alias resolves to one id.
 */
import type { AgentMessage } from '../llm/types/agent-message.js';

const ALIAS = /^m([1-9]\d{0,8})(?:\.([2-9]|[1-9]\d{1,8}))?$/u;

export function isMessageAlias(value: string): boolean {
  return ALIAS.test(value);
}

export function messageAliasOf(seq: number): string {
  return `m${seq}`;
}

function messageParts(first: unknown, slots?: unknown): Array<string | null> {
  if (Array.isArray(slots)) return slots.map(id => typeof id === 'string' && id.trim() ? id : null);
  return typeof first === 'string' && first.trim() ? [first] : [];
}

function platformIdsOf(message: AgentMessage): Array<string | null> {
  if (message.role !== 'user' && message.role !== 'assistant') return [];
  return messageParts(message.messageId, message.role === 'assistant' ? message.messageIds : undefined);
}

interface AliasState {
  counter: number;
  byId: Map<string, string>;
  byAlias: Map<string, string>;
}

function assignParts(
  ids: readonly (string | null)[],
  state: AliasState,
  hints: { aliasSeq?: number; aliasParts?: readonly (string | null)[] } = {},
  known?: MessageAliasIndex,
): Array<string | null> {
  const first = ids.findIndex(id => id !== null);
  const id = ids[first];
  if (!id) return [];
  const firstHint = hints.aliasParts?.[first];
  let alias = state.byId.get(id) ?? known?.aliasOf(id) ?? (firstHint && isMessageAlias(firstHint) ? firstHint : undefined);
  if (!alias) {
    const seq = Number.isInteger(hints.aliasSeq) && hints.aliasSeq! > state.counter ? hints.aliasSeq! : state.counter + 1;
    alias = messageAliasOf(seq);
  }
  state.counter = Math.max(state.counter, Number(ALIAS.exec(alias)?.[1] ?? 0));
  state.byId.set(id, alias);
  state.byAlias.set(alias, id);
  const parts: Array<string | null> = ids.map(() => null);
  parts[first] = alias;
  for (const [index, partId] of ids.entries()) {
    if (index === first || partId === null) continue;
    const hint = hints.aliasParts?.[index];
    let partAlias = state.byId.get(partId) ?? known?.aliasOf(partId) ?? (hint && isMessageAlias(hint) ? hint : undefined);
    if (!partAlias) {
      const base = messageAliasOf(Number(ALIAS.exec(alias)?.[1]));
      let ordinal = index + 1;
      partAlias = `${base}.${ordinal}`;
      while (state.byAlias.has(partAlias) || known?.idOf(partAlias)) partAlias = `${base}.${++ordinal}`;
    }
    state.counter = Math.max(state.counter, Number(ALIAS.exec(partAlias)?.[1] ?? 0));
    state.byId.set(partId, partAlias);
    state.byAlias.set(partAlias, partId);
    parts[index] = partAlias;
  }
  return parts;
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
  /** Ordered physical-message aliases; null means that completed slot has no confirmed message id. */
  readonly parts: ReadonlyMap<AgentMessage, readonly (string | null)[]>;
  /** Explicit unknown delivery slots only; arbitrary unknown strings are not classified here. */
  readonly unconfirmedAliases: ReadonlySet<string>;
}

export class UnconfirmedMessageAliasError extends Error {
  readonly code = 'unconfirmed_message_alias';
  readonly alias: string;

  constructor(alias: string) {
    super(`Message alias ${alias} refers to an unconfirmed delivery; no platform message id is available.`);
    this.name = 'UnconfirmedMessageAliasError';
    this.alias = alias;
  }
}

export function indexMessageAliases(messages: readonly AgentMessage[], known?: MessageAliasIndex): MessageAliasAssignment {
  const byId = new Map<string, string>();
  const byAlias = new Map<string, string>();
  const aliases = new Map<AgentMessage, string>();
  const parts = new Map<AgentMessage, readonly (string | null)[]>();
  const state: AliasState = { counter: 0, byId, byAlias };
  for (const message of messages) {
    const hints = message as { aliasSeq?: number; aliasParts?: readonly (string | null)[] };
    const rowParts = assignParts(platformIdsOf(message), state, hints, known);
    if (!rowParts.length) continue;
    aliases.set(message, rowParts.find((alias): alias is string => alias !== null)!);
    parts.set(message, rowParts);
  }
  const unconfirmedAliases = new Set<string>();
  for (const [message, rowParts] of parts) {
    const base = messageAliasOf(Number(ALIAS.exec(aliases.get(message)!)![1]));
    rowParts.forEach((alias, index) => {
      const candidate = `${base}.${index + 1}`;
      if (alias === null && !byAlias.has(candidate)) unconfirmedAliases.add(candidate);
    });
  }
  return { aliases, parts, unconfirmedAliases, aliasOf: id => byId.get(id), idOf: alias => byAlias.get(alias) };
}

/**
 * Per-turn alias <-> platform id map for tools. It accumulates every projection the turn performs,
 * so an alias the model saw in any request resolves later in the same turn.
 */
export class MessageAliasTable implements MessageAliasIndex {
  readonly #byId = new Map<string, string>();
  readonly #byAlias = new Map<string, string>();
  readonly #unconfirmedAliases = new Set<string>();

  index(messages: readonly AgentMessage[]): void {
    const next = indexMessageAliases(messages, this);
    for (const alias of next.unconfirmedAliases) this.#unconfirmedAliases.add(alias);
    for (const rowParts of next.parts.values()) {
      for (const alias of rowParts) {
        if (alias === null) continue;
        const id = next.idOf(alias);
        if (!id) continue;
        this.#byId.set(id, alias);
        this.#byAlias.set(alias, id);
      }
    }
  }

  aliasOf(platformId: string): string | undefined {
    return this.#byId.get(platformId);
  }

  idOf(alias: string): string | undefined {
    return this.#byAlias.get(alias);
  }

  /** Resolve one id; explicit unconfirmed slots throw, other unknown/raw values pass through. */
  resolve(aliasOrId: string): string {
    const alias = aliasOrId.trim();
    const id = this.#byAlias.get(alias);
    if (id) return id;
    if (this.#unconfirmedAliases.has(alias)) throw new UnconfirmedMessageAliasError(alias);
    return aliasOrId;
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

/** Closing quote, skipping escaped quotes without parsing or allocating the message body. */
function stringEnd(text: string, start: number): number {
  let end = start;
  while ((end = text.indexOf('"', end + 1)) >= 0) {
    let slashes = 0;
    while (text[end - slashes - 1] === '\\') slashes++;
    if (slashes % 2 === 0) return end;
  }
  return -1;
}

/** Select only top-level identity fields; nested tool-call arguments are never delivery evidence. */
function payloadIdentity(payload: unknown): { messageId?: unknown; messageIds?: unknown } {
  if (typeof payload !== 'string') return payload && typeof payload === 'object' ? payload : {};
  const identity: { messageId?: unknown; messageIds?: unknown } = {};
  const tokens = /[{}\[\]"]/gu;
  let depth = 0;
  let pending: { key: 'messageId' | 'messageIds'; start: number } | undefined;
  for (let token = tokens.exec(payload); token; token = tokens.exec(payload)) {
    const character = token[0];
    if (character === '"') {
      const end = stringEnd(payload, token.index);
      if (end < 0) return {};
      tokens.lastIndex = end + 1;
      if (pending?.key === 'messageId' && token.index === pending.start) {
        try { identity.messageId = JSON.parse(payload.slice(token.index, end + 1)); } catch { return {}; }
        pending = undefined;
      } else if (depth === 1) {
        const key = payload.slice(token.index + 1, end);
        if (key !== 'messageId' && key !== 'messageIds') continue;
        const separator = /^\s*:\s*/u.exec(payload.slice(end + 1));
        if (!separator) continue;
        const start = end + 1 + separator[0].length;
        if ((key === 'messageId' && payload[start] === '"') || (key === 'messageIds' && payload[start] === '[')) pending = { key, start };
      }
    } else if (character === '{' || character === '[') depth++;
    else {
      if (pending?.key === 'messageIds' && character === ']' && depth === 2) {
        try { identity.messageIds = JSON.parse(payload.slice(pending.start, token.index + 1)); } catch { return {}; }
        pending = undefined;
      }
      depth--;
    }
  }
  return identity;
}

/** Top-level platform message id without parsing the full stored payload. */
export function payloadMessageId(payload: unknown): string | undefined {
  const id = payloadIdentity(payload).messageId;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

/** Alias metadata derives once from the entire active path, including repeated physical parts. */
export function assignRowAliasMetadata<T extends { payload: unknown }>(pathRows: readonly T[]): Map<T, { aliasSeq: number; aliasParts: readonly (string | null)[] }> {
  const state: AliasState = { counter: 0, byId: new Map(), byAlias: new Map() };
  const out = new Map<T, { aliasSeq: number; aliasParts: readonly (string | null)[] }>();
  for (const row of pathRows) {
    const identity = payloadIdentity(row.payload);
    const parts = assignParts(messageParts(identity.messageId, identity.messageIds), state);
    const first = parts.find((alias): alias is string => alias !== null);
    if (first) out.set(row, { aliasSeq: Number(ALIAS.exec(first)![1]), aliasParts: parts });
  }
  return out;
}

/**
 * Session ordinal per stored row, over the whole active path (oldest first). Physical reply parts
 * share their row's ordinal; a repeated id keeps its original group and part alias.
 */
export function assignRowAliasSeqs<T extends { payload: unknown }>(pathRows: readonly T[]): Map<T, number> {
  return new Map([...assignRowAliasMetadata(pathRows)].map(([row, metadata]) => [row, metadata.aliasSeq]));
}
