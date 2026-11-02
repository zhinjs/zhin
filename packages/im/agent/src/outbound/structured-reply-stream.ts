import { parsePartialJson } from '@zhin.js/ai';
import type { AiOutboundSegmentProfile } from '@zhin.js/core';
import type { ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import type { Segment } from '@zhin.js/im-contract';
import { decodeStructuredReply, TOOL_CALL_MARKUP } from './structured-reply.js';

export interface StructuredReplyStreamParser {
  parse(raw: string, revision: number, final?: boolean): Promise<ReplyStreamSnapshot | undefined>;
}

/** Partial JSON is only a candidate; the existing message schema still owns every segment. */
export function createStructuredReplyStreamParser(profile?: AiOutboundSegmentProfile): StructuredReplyStreamParser {
  return {
    async parse(raw, revision, final = false) {
      const parsed = await parsePartialJson(raw);
      if (final) decodeStructuredReply(raw, profile);
      if (parsed.state === 'failed-parse' || parsed.state === 'undefined-input') return undefined;
      const root = object(parsed.value);
      if (!root) return undefined;
      const legacy = !('messages' in root) && Array.isArray(root.segments);
      if (Object.keys(root).some(key => ![legacy ? 'segments' : 'messages', 'reaction'].includes(key))) return undefined;
      // The ordinary decoder places reactions before words. Until the root decision is known,
      // hold words rather than moving a reaction behind an already-public message.
      if (profile?.reaction && (root.reaction !== undefined && root.reaction !== ''
        || parsed.state !== 'successful-parse' && closedRootString(raw, 'reaction') !== '')) return undefined;
      const messages = legacy ? [{ segments: root.segments }] : root.messages;
      if (!Array.isArray(messages)) return undefined;
      const whole = parsed.state === 'successful-parse';
      if (whole && !final) {
        try { decodeStructuredReply(raw, profile); } catch { return undefined; }
      }
      const projected: ReplyStreamSnapshot['messages'][number][] = [];
      for (const [messageIndex, item] of messages.entries()) {
        const message = object(item);
        if (!message || Object.keys(message).some(key => key !== 'segments')) return undefined;
        if (!Array.isArray(message.segments)) break;
        const messageComplete = whole || messageIndex < messages.length - 1;
        const segments: ReplyStreamSnapshot['messages'][number]['segments'][number][] = [];
        for (const [segmentIndex, candidate] of message.segments.entries()) {
          const complete = messageComplete || segmentIndex < message.segments.length - 1;
          const value = validateSegment(candidate, profile);
          if (!value) {
            if (complete) return undefined;
            break;
          }
          let next = value;
          if (!complete && (value.type === 'text' || value.type === 'markdown')) {
            const field = value.type === 'text' ? 'text' : 'content';
            const data = value.data as Readonly<Record<string, unknown>>;
            const text = data[field];
            if (typeof text !== 'string') break;
            const prefix = publicTextPrefix(text);
            if (prefix === undefined) return undefined;
            next = { ...value, data: { ...data, [field]: prefix } } as Segment;
          }
          segments.push({ key: `segment-${segmentIndex}`, complete, value: next });
        }
        projected.push({ key: `message-${messageIndex}`, complete: messageComplete, segments });
      }
      return { revision, messages: projected };
    },
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validateSegment(value: unknown, profile?: AiOutboundSegmentProfile): Segment | undefined {
  try {
    const output = decodeStructuredReply(JSON.stringify({ messages: [{ segments: [value] }] }), profile);
    const message = output[0];
    return message?.type === 'message' ? message.segments[0] : undefined;
  } catch { return undefined; }
}

/** Never publish the beginning of markup the final decoder would reject. */
function publicTextPrefix(text: string): string | undefined {
  if (TOOL_CALL_MARKUP.test(text)) return undefined;
  let end = text.length;
  if (/[\uD800-\uDBFF]$/.test(text)) end -= 1;
  const start = text.lastIndexOf('<');
  if (start >= 0) {
    const tail = text.slice(start).toLowerCase();
    const names = ['invoke', 'tool_call', 'tool_calls', 'function_call', 'function_calls', 'antml:'];
    if (names.some(name => (`<${name}`).startsWith(tail) || (`</${name}`).startsWith(tail))
      || /^<[｜|]{1,2}\s*(?:d(?:s(?:m(?:l)?)?)?)?$/iu.test(tail)) end = Math.min(end, start);
  }
  return text.slice(0, end);
}

/** Locate a closed root string field; partial-JSON repair cannot prove its closing quote existed. */
function closedRootString(raw: string, field: string): string | undefined {
  let depth = 0;
  let result: string | undefined;
  const stringEnd = (start: number) => {
    for (let i = start + 1; i < raw.length; i++) {
      if (raw[i] === '\\') i++;
      else if (raw[i] === '"') return i;
    }
    return -1;
  };
  const afterSpace = (start: number) => { while (/\s/.test(raw[start] ?? '') && start < raw.length) start++; return start; };
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{' || raw[i] === '[') depth++;
    else if (raw[i] === '}' || raw[i] === ']') depth--;
    else if (raw[i] === '"') {
      const end = stringEnd(i);
      if (end < 0) break;
      const colon = afterSpace(end + 1);
      if (depth === 1 && raw[colon] === ':') {
        let key: unknown;
        try { key = JSON.parse(raw.slice(i, end + 1)); } catch { return undefined; }
        if (key === field) {
          const valueStart = afterSpace(colon + 1);
          const valueEnd = raw[valueStart] === '"' ? stringEnd(valueStart) : -1;
          if (valueEnd < 0) return undefined;
          try { result = JSON.parse(raw.slice(valueStart, valueEnd + 1)) as string; } catch { return undefined; }
          i = valueEnd;
          continue;
        }
      }
      i = end;
    }
  }
  return result;
}
