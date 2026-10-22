import Ajv, { type ValidateFunction } from 'ajv';
import {
  aiOutboundJsonSchema,
  buildAiOutboundJsonSchema,
  DEFAULT_AI_OUTBOUND_SEGMENT_TYPES,
  type AiOutboundSegmentProfile,
  type AiOutboundSegmentType,
} from '@zhin.js/core';
import type { Segment } from '@zhin.js/im-contract';
import type { AgentOutputElement } from './agent-output.js';

const ajv = new Ajv();
// Compiled, stateless contract validators keyed by segment set; no generation-owned data.
const validators = new Map<string, ValidateFunction<{ segments: Segment[] }>>();
const DEFAULT_PROFILE: AiOutboundSegmentProfile = { types: DEFAULT_AI_OUTBOUND_SEGMENT_TYPES };
const schemas = new Map<string, Record<string, unknown>>([[key(DEFAULT_PROFILE), aiOutboundJsonSchema]]);

function key(profile: AiOutboundSegmentProfile): string {
  return JSON.stringify([[...profile.types].sort(), profile.extensions ?? {}]);
}

/** Provider-facing schema for exactly this endpoint profile (cached, stable identity). */
export function structuredReplySchema(profile: AiOutboundSegmentProfile = DEFAULT_PROFILE): Record<string, unknown> {
  const id = key(profile);
  let schema = schemas.get(id);
  if (!schema) schemas.set(id, schema = buildAiOutboundJsonSchema(profile.types, profile.extensions));
  return schema;
}

const SEGMENT_GUIDE: readonly (readonly [readonly AiOutboundSegmentType[], string])[] = [
  [['text'], 'text: {"type":"text","data":{"text":"..."}} for plain text.'],
  [['mention'], 'mention: {"type":"mention","data":{"target":"<user id>"}}. The target is a real user platform ID from the current conversation context or a member lookup tool result, never an endpoint ID, role or guessed nickname, and always a JSON string even for numeric IDs ("123", never 123). Use the Sender id to mention the current sender; to mention someone else by name, look the member up with the available platform tools; if the name is ambiguous or no ID is available, ask for clarification in a text segment.'],
  [['markdown'], 'markdown: {"type":"markdown","data":{"content":"..."}} for formatted text (lists, bold, code, tables); platforms without Markdown receive plain text.'],
  [['image', 'audio', 'video', 'file'], 'image / audio / video / file: {"type":"image","data":{"media":{"kind":"url","value":"https://..."}}}; kind is url, path (a workspace file) or base64. Only reference media you produced or were given; never Markdown image syntax.'],
  [['keyboard'], 'keyboard: {"type":"keyboard","data":{"rows":[[{"label":"查看详情","payload":"/detail 1"}]]}} offers quick-reply buttons (at most 5 per row); tapping one sends its payload as the user\'s next message. Place it after the text it belongs to and use it only for concrete next steps.'],
  [['share'], 'share: {"type":"share","data":{"url":"https://...","title":"..."}} for a link card.'],
  [['dice', 'rps'], 'dice / rps: {"type":"dice","data":{}} or {"type":"rps","data":{}} sends the platform\'s random dice or rock-paper-scissors.'],
];

/** The final-reply contract for this endpoint; lists only the segment types it can deliver. */
export function structuredReplyInstruction(profile: AiOutboundSegmentProfile = DEFAULT_PROFILE): string {
  const { types } = profile;
  const hints = types.flatMap(type => {
    const hint = profile.extensions?.[type]?.hint;
    return hint ? [`- ${type} on this platform: ${hint}`] : [];
  });
  return [
    'Your final reply must be a JSON object matching the supplied schema: {"segments":[...]} with no Markdown fence or surrounding prose.',
    'Every reply, including plain text, uses this one ordered array. Example: {"segments":[{"type":"mention","data":{"target":"123"}},{"type":"text","data":{"text":"，请查收。"}}]}.',
    `Segment types available on this platform: ${types.join(', ')}.`,
    ...SEGMENT_GUIDE.filter(([covers]) => covers.some(type => types.includes(type))).map(([, line]) => `- ${line}`),
    ...hints,
    'Do not invent IDs or media references. Plain @name text does not notify anyone. Keep mentions, media and buttons as their own segments and preserve the intended order.',
    'Business tool calls use their normal tool schemas; this message schema describes only the final user-facing answer, including the json response tool when supplied. Use {"segments":[]} only when no reply is needed.',
  ].join('\n');
}

export const STRUCTURED_REPLY_INSTRUCTION = structuredReplyInstruction();

/** Reject the whole response on mismatch: never deliver raw JSON or partial segments. */
export function decodeStructuredReply(
  raw: string,
  profile: AiOutboundSegmentProfile = DEFAULT_PROFILE,
): AgentOutputElement[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Agent final reply is not valid JSON'); }
  const id = key(profile);
  let validateReply = validators.get(id);
  if (!validateReply) validators.set(id, validateReply = ajv.compile<{ segments: Segment[] }>(structuredReplySchema(profile)));
  if (!validateReply(value)) {
    const errors = validateReply.errors ?? [];
    const fields = errors.filter(error => error.keyword === 'type' && error.instancePath.includes('/data/'));
    const detail = (fields.length ? fields : errors).slice(0, 8)
      .map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Agent final reply does not match the message schema: ${detail}`);
  }
  const segments = value.segments.map(segment => withoutEmptyModelFields(segment, profile));
  return segments.length ? [{ type: 'message', segments }] : [];
}

/** Declared extension fields are required in the schema; "" means the model had no value. */
function withoutEmptyModelFields(segment: Segment, profile: AiOutboundSegmentProfile): Segment {
  const fields = profile.extensions?.[segment.type as AiOutboundSegmentType]?.fields;
  const data = segment.data as Record<string, unknown>;
  if (!fields?.some(field => data[field] === '')) return segment;
  return { ...segment, data: Object.fromEntries(Object.entries(data)
    .filter(([field, value]) => !(fields.includes(field) && value === ''))) } as Segment;
}
