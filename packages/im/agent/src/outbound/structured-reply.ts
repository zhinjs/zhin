import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
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
const validators = new Map<string, ValidateFunction<StructuredReply>>();

interface StructuredReply {
  messages: { segments: Segment[] }[];
  reaction?: string;
}

/** Segment of the internal message that carries a reaction; the reply port applies it, never sends it. */
export const REACTION_SEGMENT_TYPE = 'reaction';
const DEFAULT_PROFILE: AiOutboundSegmentProfile = { types: DEFAULT_AI_OUTBOUND_SEGMENT_TYPES };
const schemas = new Map<string, Record<string, unknown>>([[key(DEFAULT_PROFILE), aiOutboundJsonSchema]]);

function key(profile: AiOutboundSegmentProfile): string {
  return JSON.stringify([[...profile.types].sort(), profile.extensions ?? {}, profile.reaction?.values.map(item => item.value) ?? []]);
}

/** Provider-facing schema for exactly this endpoint profile (cached, stable identity). */
export function structuredReplySchema(profile: AiOutboundSegmentProfile = DEFAULT_PROFILE): Record<string, unknown> {
  const id = key(profile);
  let schema = schemas.get(id);
  if (!schema) schemas.set(id, schema = buildAiOutboundJsonSchema(profile.types, profile.extensions, profile.reaction));
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
    'Your final reply must be a JSON object matching the supplied schema: {"messages":[{"segments":[...]}]} with no Markdown fence or surrounding prose.',
    'Each item of messages is one chat message, sent in order. Usually send one; split into two or three only where a person would send separate messages, such as a quick reaction followed by the answer. Example: {"messages":[{"segments":[{"type":"text","data":{"text":"调好了"}}]},{"segments":[{"type":"text","data":{"text":"你再试试"}}]}]}.',
    `Segment types available on this platform: ${types.join(', ')}.`,
    ...SEGMENT_GUIDE.filter(([covers]) => covers.some(type => types.includes(type))).map(([, line]) => `- ${line}`),
    ...hints,
    'Do not invent IDs or media references. Plain @name text does not notify anyone. Keep mentions, media and buttons as their own segments and preserve the intended order.',
    'The reply already goes to this conversation: mention someone only to call that person in.',
    'Business tool calls use their normal tool schemas; this message schema describes only the final user-facing answer, including the json response tool when supplied. Use {"messages":[]} only when no reply is needed.',
    ...(profile.reaction ? reactionInstruction(profile.reaction.values) : []),
  ].join('\n');
}

function reactionInstruction(values: readonly { readonly value: string; readonly label: string }[]): string[] {
  return [
    `"reaction" puts a reaction on the message you are answering, the way a person taps one instead of typing. Values here: ${values.map(item => `${item.value} ${item.label}`).join(', ')}; "" for none.`,
    'A reaction alone ({"messages":[],"reaction":"<value>"}) is often the most natural answer to thanks, agreement, a joke or news that needs no words. A reaction plus a short message is fine; do not say in words what the reaction already says.',
  ];
}

export const STRUCTURED_REPLY_INSTRUCTION = structuredReplyInstruction();

/**
 * Tool-call markup a model wrote as text because the provider did not parse it (DeepSeek DSML,
 * XML-style function calls). It is never a chat message, whatever else the reply contains.
 */
export const TOOL_CALL_MARKUP = /<[｜|]{1,2}\s*DSML|<\/?(?:invoke|tool_call|tool_calls|function_calls?|antml:[a-z_]+)\b/iu;

/** Reject the whole response on mismatch: never deliver raw JSON or partial segments. */
export function decodeStructuredReply(
  raw: string,
  profile: AiOutboundSegmentProfile = DEFAULT_PROFILE,
): AgentOutputElement[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Agent final reply is not valid JSON'); }
  // Replies persisted before multi-message replies are a single {segments} message; models may echo it.
  if (value && typeof value === 'object' && !Array.isArray(value) && 'segments' in value && !('messages' in value)) {
    value = { messages: [value] };
  }
  // "reaction" is required only to satisfy strict schemas; a reply without it simply has none.
  if (profile.reaction && value && typeof value === 'object' && !Array.isArray(value) && !('reaction' in value)) {
    value = { ...value, reaction: '' };
  }
  // Where reactions are not offered, a reaction the model wrote anyway is dropped, not a format error.
  if (!profile.reaction && value && typeof value === 'object' && !Array.isArray(value) && 'reaction' in value) {
    const { reaction: _ignored, ...rest } = value as Record<string, unknown>;
    value = rest;
  }
  const id = key(profile);
  let validateReply = validators.get(id);
  if (!validateReply) validators.set(id, validateReply = ajv.compile<StructuredReply>(structuredReplySchema(profile)));
  // Models often write IDs (mention targets, reply ids) as JSON numbers; a number where the schema
  // wants a string is the same ID, not a format error worth a correction call.
  if (!validateReply(value)) stringifyNumbersWhereStringsExpected(value, validateReply.errors ?? []);
  if (!validateReply(value)) {
    const errors = validateReply.errors ?? [];
    const fields = errors.filter(error => error.keyword === 'type' && error.instancePath.includes('/data/'));
    const detail = (fields.length ? fields : errors).slice(0, 8)
      .map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Agent final reply does not match the message schema: ${detail}`);
  }
  for (const message of value.messages) {
    for (const segment of message.segments) {
      const data = segment.data as Record<string, unknown>;
      if ([data.text, data.content].some(field => typeof field === 'string' && TOOL_CALL_MARKUP.test(field))) {
        throw new Error('Agent final reply contains tool-call markup');
      }
    }
  }
  const messages: AgentOutputElement[] = value.messages.filter(message => message.segments.length > 0)
    .map(message => ({ type: 'message', segments: message.segments.map(segment => withoutEmptyModelFields(segment, profile)) }));
  // React first, then talk, like a person tapping a reaction before typing.
  return value.reaction
    ? [{ type: 'message', segments: [{ type: REACTION_SEGMENT_TYPE, data: { emoji: value.reaction } } as Segment] }, ...messages]
    : messages;
}

function stringifyNumbersWhereStringsExpected(value: unknown, errors: readonly ErrorObject[]): void {
  for (const error of errors) {
    if (error.keyword !== 'type' || (error.params as { type?: unknown }).type !== 'string') continue;
    const path = error.instancePath.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    const field = path.pop();
    let parent: unknown = value;
    for (const part of path) parent = (parent as Record<string, unknown> | undefined)?.[part];
    if (field === undefined || !parent || typeof parent !== 'object') continue;
    const current = (parent as Record<string, unknown>)[field];
    if (typeof current === 'number' && Number.isSafeInteger(current)) (parent as Record<string, unknown>)[field] = String(current);
  }
}

/** Declared extension fields are required in the schema; "" means the model had no value. */
function withoutEmptyModelFields(segment: Segment, profile: AiOutboundSegmentProfile): Segment {
  const fields = profile.extensions?.[segment.type as AiOutboundSegmentType]?.fields;
  const data = segment.data as Record<string, unknown>;
  if (!fields?.some(field => data[field] === '')) return segment;
  return { ...segment, data: Object.fromEntries(Object.entries(data)
    .filter(([field, value]) => !(fields.includes(field) && value === ''))) } as Segment;
}
