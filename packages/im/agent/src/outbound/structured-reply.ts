import Ajv from 'ajv';
import { aiOutboundJsonSchema } from '@zhin.js/core';
import type { Segment } from '@zhin.js/im-contract';
import type { AgentOutputElement } from './agent-output.js';

// A compiled, stateless contract validator; no generation-owned data is stored.
const validateReply = new Ajv().compile<{ segments: Segment[] }>(aiOutboundJsonSchema);

export const STRUCTURED_REPLY_INSTRUCTION = [
  'Your final reply must be a JSON object matching the supplied schema: {"segments":[...]} with no Markdown fence or surrounding prose.',
  'Every reply, including plain text, uses this one ordered array. Example: {"segments":[{"type":"mention","data":{"target":"123"}},{"type":"text","data":{"text":"，请查收。"}}]}.',
  'A mention target is a real user platform ID from the current conversation context or a member lookup tool result, never an endpoint ID, role or guessed nickname.',
  'Use the Sender id to mention the current sender. To mention someone else by name, look up that member with the available platform tools. If the name is ambiguous or no ID is available, ask for clarification in a text segment.',
  'Use text.data.text for plain text, markdown.data.content for formatted Markdown, and image/audio/video/file.data.media with kind and value for attachments. Keep media and mentions as separate ordered segments, not Markdown image syntax or literal @name.',
  'Do not invent IDs or media references. Plain @name text does not notify anyone. Preserve the intended order of text, mentions and media.',
  'Tool calls use their normal tool schemas; this message schema describes only the final user-facing answer. Use {"segments":[]} only when no reply is needed.',
].join('\n');

/** Reject the whole response on mismatch: never deliver raw JSON or partial segments. */
export function decodeStructuredReply(raw: string): AgentOutputElement[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Agent final reply is not valid JSON'); }
  if (!validateReply(value)) throw new Error('Agent final reply does not match the message schema');
  return value.segments.length ? [{ type: 'message', segments: value.segments }] : [];
}
