/**
 * ADR 0041 §3 message segments: pure, stable chronological merge.
 *
 * Rules applied here:
 *  - messages merge by timestamp, each segment's own order preserved (k-way merge); ties go
 *    `state → user → tool → assistant`, then higher `weight`, then segment order;
 *  - tool call / result pairing is validated and orphans are rejected; a result is never merged
 *    ahead of its call;
 *  - a `state` event that would land between an assistant tool_calls message and its results is
 *    moved after the last result of that group (any other message there is an error);
 *  - append-only: messages already sent keep their position, everything else is appended.
 */
import type { AgentMessage } from '@zhin.js/ai';
import { MESSAGE_KIND_TIE_ORDER, type MessageSegmentKind } from './types.js';

export interface MessageSegmentOutput {
  readonly id: string;
  readonly kind: MessageSegmentKind;
  readonly weight: number;
  /** Oldest first. */
  readonly messages: readonly AgentMessage[];
}

export interface MergeMessageSegmentsOptions {
  /**
   * The messages already sent to the model (a previous merge result). They keep their position and
   * order when still present; all other messages, including late-arriving events with older
   * timestamps, are appended after them.
   */
  readonly sent?: readonly AgentMessage[];
}

export class PromptSegmentMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptSegmentMergeError';
  }
}

function toolCallIds(message: AgentMessage): string[] {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return [];
  return (message.content as Array<{ type?: string; id?: string }>)
    .filter(block => block?.type === 'toolCall' && typeof block.id === 'string')
    .map(block => block.id!);
}

function toolResultId(message: AgentMessage): string | undefined {
  return message.role === 'toolResult' ? (message as { toolCallId?: string }).toolCallId : undefined;
}

function validatePairing(outputs: readonly MessageSegmentOutput[]): void {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const output of outputs) {
    for (const message of output.messages) {
      for (const id of toolCallIds(message)) {
        if (calls.has(id)) throw new PromptSegmentMergeError(`Duplicate tool call id: ${id}`);
        calls.add(id);
      }
      const resultId = toolResultId(message);
      if (resultId !== undefined) {
        if (results.has(resultId)) throw new PromptSegmentMergeError(`Duplicate tool result for call: ${resultId}`);
        results.add(resultId);
      }
    }
  }
  for (const id of results) {
    if (!calls.has(id)) throw new PromptSegmentMergeError(`Orphan tool result without a tool call: ${id}`);
  }
  for (const id of calls) {
    if (!results.has(id)) throw new PromptSegmentMergeError(`Orphan tool call without a tool result: ${id}`);
  }
}

function tieRank(kind: MessageSegmentKind): number {
  const index = MESSAGE_KIND_TIE_ORDER.indexOf(kind);
  if (index < 0) throw new PromptSegmentMergeError(`Not a message segment kind: ${String(kind)}`);
  return index;
}

function chronological(outputs: readonly MessageSegmentOutput[]): AgentMessage[] {
  const lists = outputs.map((output, order) => {
    let running = Number.NEGATIVE_INFINITY;
    return {
      output,
      order,
      rank: tieRank(output.kind),
      cursor: 0,
      // A list is consumed in its own order: a regressing timestamp inherits the running maximum.
      stamps: output.messages.map((message) => {
        const stamp = Number.isFinite(message.timestamp) ? message.timestamp : running;
        running = Math.max(running, stamp);
        return running;
      }),
    };
  });
  const total = lists.reduce((sum, list) => sum + list.output.messages.length, 0);
  const emittedCalls = new Set<string>();
  const merged: AgentMessage[] = [];
  while (merged.length < total) {
    let best: (typeof lists)[number] | undefined;
    for (const list of lists) {
      if (list.cursor >= list.output.messages.length) continue;
      const head = list.output.messages[list.cursor]!;
      const resultId = toolResultId(head);
      if (resultId !== undefined && !emittedCalls.has(resultId)) continue;
      if (!best) { best = list; continue; }
      const delta = list.stamps[list.cursor]! - best.stamps[best.cursor]!
        || list.rank - best.rank
        || best.output.weight - list.output.weight
        || list.order - best.order;
      if (delta < 0) best = list;
    }
    if (!best) throw new PromptSegmentMergeError('Tool result precedes its tool call inside a segment');
    const message = best.output.messages[best.cursor]!;
    best.cursor += 1;
    for (const id of toolCallIds(message)) emittedCalls.add(id);
    merged.push(message);
  }
  return merged;
}

function messageKey(message: AgentMessage): string {
  const m = message as { name?: unknown; messageId?: unknown; toolCallId?: unknown; kind?: unknown };
  return JSON.stringify([message.role, message.timestamp, m.name, m.messageId, m.toolCallId, m.kind, toolCallIds(message)]);
}

/** Splits `merged` into the part that was already sent (kept in `sent` order) and the new rest. */
function splitSent(merged: readonly AgentMessage[], sent: readonly AgentMessage[]): { kept: AgentMessage[]; rest: AgentMessage[] } {
  const byRef = new Set(merged);
  const sentSet = new Set(sent);
  const remaining = new Map<string, number>();
  for (const message of merged) {
    if (!sentSet.has(message)) remaining.set(messageKey(message), (remaining.get(messageKey(message)) ?? 0) + 1);
  }
  const used = new Set<AgentMessage>();
  const kept: AgentMessage[] = [];
  const keptKeys = new Map<string, number>();
  for (const message of sent) {
    if (byRef.has(message)) {
      kept.push(message);
      used.add(message);
      continue;
    }
    const key = messageKey(message);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      keptKeys.set(key, (keptKeys.get(key) ?? 0) + 1);
      kept.push(message);
    }
  }
  const rest: AgentMessage[] = [];
  const consumedByKey = new Map(keptKeys);
  for (const message of merged) {
    if (used.has(message)) continue;
    const key = messageKey(message);
    const consumed = consumedByKey.get(key) ?? 0;
    if (consumed > 0) { consumedByKey.set(key, consumed - 1); continue; }
    rest.push(message);
  }
  return { kept, rest };
}

function relocateEvents(kept: readonly AgentMessage[], rest: readonly AgentMessage[]): AgentMessage[] {
  const pending = new Set<string>();
  for (const message of kept) {
    for (const id of toolCallIds(message)) pending.add(id);
    const resultId = toolResultId(message);
    if (resultId !== undefined) pending.delete(resultId);
  }
  const out: AgentMessage[] = [];
  const deferred: AgentMessage[] = [];
  for (const message of rest) {
    const calls = toolCallIds(message);
    const resultId = toolResultId(message);
    if (resultId !== undefined) {
      pending.delete(resultId);
      out.push(message);
      if (pending.size === 0 && deferred.length) out.push(...deferred.splice(0));
    } else if (pending.size > 0 && message.role === 'event') {
      deferred.push(message);
    } else if (pending.size > 0) {
      throw new PromptSegmentMergeError(`A ${message.role} message would interrupt an unfinished tool call group`);
    } else {
      out.push(message);
      for (const id of calls) pending.add(id);
    }
  }
  if (deferred.length) out.push(...deferred);
  return out;
}

export function mergeMessageSegments(
  outputs: readonly MessageSegmentOutput[],
  options: MergeMessageSegmentsOptions = {},
): AgentMessage[] {
  validatePairing(outputs);
  const merged = chronological(outputs);
  const { kept, rest } = options.sent?.length ? splitSent(merged, options.sent) : { kept: [], rest: merged };
  return [...kept, ...relocateEvents(kept, rest)];
}
