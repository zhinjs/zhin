/**
 * Test-only legacy oracle frozen from main 78519074d:
 * packages/im/agent/src/outbound/structured-reply-stream.ts.
 * Only the local decoder import and exported parser names differ from that source.
 * Keep this implementation independent of the replacement incremental parser.
 */
import { parsePartialJson } from '@zhin.js/ai';
import type { AiOutboundSegmentProfile } from '@zhin.js/core';
import type { ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import type { Segment } from '@zhin.js/im-contract';
import { decodeStructuredReply, TOOL_CALL_MARKUP } from '../../src/outbound/structured-reply.js';

export interface LegacyStructuredReplyStreamParser {
  parse(raw: string, revision: number, final?: boolean): Promise<ReplyStreamSnapshot | undefined>;
}

/** Partial JSON is only a candidate; the existing message schema still owns every segment. */
export function createLegacyStructuredReplyStreamParser(profile?: AiOutboundSegmentProfile): LegacyStructuredReplyStreamParser {
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

/** Feed raw.slice(0, end) at any UTF-16 split; use final=true only at the final boundary. */
export interface StructuredReplyStreamCorpusCase {
  readonly name: string;
  readonly raw: string;
  readonly profile?: AiOutboundSegmentProfile;
}

const reactionProfile: AiOutboundSegmentProfile = {
  types: ['text', 'markdown', 'image', 'mention', 'keyboard'],
  reaction: { values: [{ value: 'ok', label: 'OK' }, { value: 'heart', label: 'Heart' }] },
};
const textOnlyProfile: AiOutboundSegmentProfile = { types: ['text'] };
const textSegment = (text: string) => ({ type: 'text', data: { text } });
const markdownSegment = (content: string) => ({ type: 'markdown', data: { content } });
const messageJson = (...segments: unknown[]) => JSON.stringify({ segments });
const rootJson = (...messages: unknown[]) => JSON.stringify({ messages });
const message = (...segments: unknown[]) => ({ segments });
const image = { type: 'image', data: { media: { kind: 'url', value: 'https://example.invalid/image.png' } } };

/** Deliberately includes final decoder failures; compare rejected errors as well as snapshots. */
export const structuredReplyStreamCorpus: readonly StructuredReplyStreamCorpusCase[] = [
  { name: 'plain-single-message', raw: rootJson(message(textSegment('first second'))) },
  { name: 'legacy-segments-root', raw: messageJson(textSegment('legacy')) },
  { name: 'empty-message-list', raw: '{"messages":[]}' },
  { name: 'empty-and-nonempty-messages', raw: rootJson(message(), message(textSegment('visible')), message()) },
  { name: 'adjacent-text-and-multiple-messages', raw: rootJson(message(textSegment('first'), textSegment(' second')), message(textSegment('last'))) },
  { name: 'markdown-format-boundary', raw: rootJson(message(textSegment('before'), markdownSegment('**bold**\n```ts\nconst x = "value";\n```'), textSegment('after'))) },
  { name: 'whitespace-between-tokens', raw: ' \n { "messages" : [ { "segments" : [ { "data" : { "text" : "spaced" }, "type" : "text" } ] } ] } \t' },
  { name: 'escaped-string-content', raw: rootJson(message(textSegment('quote " slash \\ solidus / tab\t newline\n controls\b\f\r braces {}[]'))) },
  { name: 'literal-unicode-and-surrogate-pair', raw: rootJson(message(textSegment('你好 🌍 e\u0301 🧑‍💻'))) },
  { name: 'escaped-unicode-pair', raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"\\u4f60\\u597d \\uD83D\\uDE00"}}]}]}' },
  { name: 'unpaired-high-surrogate', raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"prefix\\uD83D"}}]}]}' },
  { name: 'escaped-root-and-segment-keys', raw: '{"mes\\u0073ages":[{"seg\\u006dents":[{"ty\\u0070e":"text","da\\u0074a":{"te\\u0078t":"escaped keys"}}]}]}' },
  { name: 'duplicate-root-messages-last-wins', raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"old"}}]}],"messages":[{"segments":[{"type":"text","data":{"text":"new"}}]}]}' },
  { name: 'duplicate-segments-last-wins', raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"old"}}],"segments":[{"type":"text","data":{"text":"new"}}]}]}' },
  { name: 'duplicate-text-last-wins', raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"old","text":"new"}}]}]}' },
  { name: 'numeric-mention-id-normalization', raw: rootJson(message({ type: 'mention', data: { target: 123456 } }, textSegment(' hello'))) },
  { name: 'reaction-before-words-empty', profile: reactionProfile, raw: '{"reaction":"","messages":[{"segments":[{"type":"text","data":{"text":"visible"}}]}]}' },
  { name: 'reaction-after-words-empty', profile: reactionProfile, raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"wait for reaction"}}]}],"reaction":""}' },
  { name: 'reaction-before-words-nonempty', profile: reactionProfile, raw: '{"reaction":"ok","messages":[{"segments":[{"type":"text","data":{"text":"ordinary path"}}]}]}' },
  { name: 'reaction-after-words-nonempty', profile: reactionProfile, raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"ordinary path"}}]}],"reaction":"ok"}' },
  { name: 'reaction-omitted-with-profile', profile: reactionProfile, raw: rootJson(message(textSegment('default empty reaction'))) },
  { name: 'reaction-ignored-without-profile', raw: '{"reaction":"ok","messages":[{"segments":[{"type":"text","data":{"text":"no reaction capability"}}]}]}' },
  { name: 'escaped-reaction-key', profile: reactionProfile, raw: '{"reac\\u0074ion":"","messages":[{"segments":[{"type":"text","data":{"text":"visible"}}]}]}' },
  { name: 'duplicate-reaction-empty-then-nonempty', profile: reactionProfile, raw: '{"reaction":"","messages":[{"segments":[{"type":"text","data":{"text":"candidate"}}]}],"reaction":"ok"}' },
  { name: 'duplicate-reaction-nonempty-then-empty', profile: reactionProfile, raw: '{"reaction":"ok","messages":[{"segments":[{"type":"text","data":{"text":"candidate"}}]}],"reaction":""}' },
  { name: 'reaction-looking-content-is-not-root', profile: reactionProfile, raw: rootJson(message(textSegment('nested "reaction":"" should not admit words early'))) },
  { name: 'atomic-image-between-text', raw: rootJson(message(textSegment('before'), image, textSegment('after'))) },
  { name: 'atomic-image-as-last-segment', raw: rootJson(message(image)) },
  { name: 'atomic-inline-media', raw: rootJson(message({ type: 'image', data: { media: { kind: 'base64', value: 'QUJDRA==', mime_type: 'image/png' } } })) },
  { name: 'atomic-keyboard', raw: rootJson(message(textSegment('Choose'), { type: 'keyboard', data: { rows: [[{ id: 'yes', label: 'Yes', payload: 'yes' }]] } })) },
  { name: 'profile-rejects-markdown', profile: textOnlyProfile, raw: rootJson(message(markdownSegment('not offered'))) },
  { name: 'profile-rejects-media', profile: textOnlyProfile, raw: rootJson(message(image)) },
  { name: 'invalid-closed-first-segment', raw: rootJson(message({ type: 'bogus', data: {} }, textSegment('later'))) },
  { name: 'invalid-closed-middle-message', raw: rootJson(message(textSegment('first'), { type: 'bogus', data: {} }), message(textSegment('later'))) },
  { name: 'invalid-segment-data-extra-field', raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"safe","extra":1}}]}]}' },
  { name: 'invalid-message-extra-field', raw: '{"messages":[{"extra":1,"segments":[{"type":"text","data":{"text":"safe"}}]}]}' },
  { name: 'invalid-root-extra-field', raw: '{"extra":1,"messages":[{"segments":[{"type":"text","data":{"text":"safe"}}]}]}' },
  { name: 'invalid-closed-media-data', raw: rootJson(message({ type: 'image', data: { media: { kind: 'wrong', value: 'bad' } } }, textSegment('later'))) },
  { name: 'tool-markup-text', raw: rootJson(message(textSegment('safe <tool_call>bad</tool_call>'))) },
  { name: 'tool-markup-markdown', raw: rootJson(message(markdownSegment('safe <｜DSML invoke="bad">'))) },
  { name: 'markup-looking-safe-text', raw: rootJson(message(textSegment('safe <table>content</table> and less < than'))) },
  { name: 'root-array-invalid', raw: '[{"segments":[{"type":"text","data":{"text":"invalid root"}}]}]' },
  { name: 'truncated-open-text', raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"unfinished' },
  { name: 'truncated-open-reaction', profile: reactionProfile, raw: '{"reaction":"' },
];
