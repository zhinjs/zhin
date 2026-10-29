import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import {
  aiOutboundJsonSchema,
  buildAiOutboundJsonSchema,
  DEFAULT_AI_OUTBOUND_SEGMENT_TYPES,
  type AiOutboundSegmentProfile,
  type AiOutboundSegmentType,
} from '@zhin.js/core';
import { registerStructuredOutputPromptText } from '@zhin.js/ai';
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
const schemas = new Map<string, Record<string, unknown>>();

function key(profile: AiOutboundSegmentProfile): string {
  return JSON.stringify([[...profile.types].sort(), profile.extensions ?? {}, profile.reaction?.values.map(item => item.value) ?? []]);
}

/** Provider-facing schema for exactly this endpoint profile (cached, stable identity). */
export function structuredReplySchema(profile: AiOutboundSegmentProfile = DEFAULT_PROFILE): Record<string, unknown> {
  const id = key(profile);
  let schema = schemas.get(id);
  if (!schema) {
    schema = id === key(DEFAULT_PROFILE)
      ? aiOutboundJsonSchema
      : buildAiOutboundJsonSchema(profile.types, profile.extensions, profile.reaction);
    schemas.set(id, schema);
    // Prompt-mode providers show this instead of the JSON text (ADR 0042 §6); native providers get the schema.
    registerStructuredOutputPromptText(schema, compactStructuredReplyPrompt(schema, profile));
  }
  return schema;
}

type SchemaNode = Record<string, unknown>;

/** Schema node -> terse shape text: `{text:str}`, `"url"|"path"`, `[{label:str}]`. */
function shape(node: SchemaNode): string {
  if ('const' in node) return JSON.stringify(node.const);
  if (Array.isArray(node.enum)) return node.enum.map(value => JSON.stringify(value)).join('|');
  if (Array.isArray(node.anyOf)) return (node.anyOf as SchemaNode[]).map(shape).join('|');
  switch (node.type) {
    case 'string': return 'str';
    case 'number': case 'integer': return 'num';
    case 'boolean': return 'bool';
    case 'array': return `[${shape((node.items ?? {}) as SchemaNode)}]`;
    case 'object': {
      const properties = (node.properties ?? {}) as Record<string, SchemaNode>;
      return `{${Object.entries(properties).map(([name, child]) => `${name}:${shape(child)}`).join(',')}}`;
    }
    default: return 'any';
  }
}

/**
 * Prompt-mode form of the reply schema: one example plus one shape line per segment type, derived
 * from the schema itself so it cannot drift. `decodeStructuredReply` still validates with the schema.
 */
export function compactStructuredReplyPrompt(schema: SchemaNode, profile: AiOutboundSegmentProfile = DEFAULT_PROFILE): string {
  const root = (schema.properties as Record<string, SchemaNode>);
  const branches = ((((root.messages!.items as SchemaNode).properties as Record<string, SchemaNode>).segments!.items as SchemaNode).anyOf ?? []) as SchemaNode[];
  const lines = branches.map(branch => {
    const properties = branch.properties as Record<string, SchemaNode>;
    const types = 'const' in properties.type! ? [properties.type!.const] : (properties.type!.enum as string[]);
    return `- ${types.join('|')}: data=${shape(properties.data!)}`;
  });
  const hasExtraFields = Object.values(profile.extensions ?? {}).some(extension => extension?.fields?.length);
  return [
    'Respond with only a JSON object, no prose and no Markdown fence. Example:',
    `{"messages":[{"segments":[{"type":"text","data":{"text":"好的"}}]}]${root.reaction ? ',"reaction":""' : ''}}`,
    'Each segment is {"type":T,"data":D}; D per type (every listed key required, no others):',
    ...lines,
    ...(hasExtraFields ? ['Extra string fields: write "" when unknown.'] : []),
    ...(root.reaction ? [`"reaction": ${shape(root.reaction)}`] : []),
  ].join('\n');
}

const SEGMENT_GUIDE: readonly (readonly [readonly AiOutboundSegmentType[], string])[] = [
  [['text'], 'plain text.'],
  [['mention'], 'target must be a real platform user ID string ("123", not 123), from context or member lookup; never an endpoint ID, role or guessed nickname. Use Sender id for the sender; look up others by name, ask for clarification in text if missing/ambiguous. Plain @name does not notify. Reply is already in this conversation: mention only to call someone in.'],
  [['markdown'], 'formatted text (lists, bold, code, tables); degrades to plain text where unsupported.'],
  [['image', 'audio', 'video', 'file'], 'media.kind is url, path (workspace file) or base64. Use only media produced or given to you, as separate segments, never Markdown image syntax.'],
  [['keyboard'], 'quick-reply buttons: at most 5 per row; tapping sends payload as the next user message. Use only for concrete next steps, after the related text.'],
  [['share'], 'link card with url and title.'],
  [['dice'], 'platform random dice.'],
  [['rps'], 'platform random rock-paper-scissors.'],
];

/** The final-reply contract for this endpoint; lists only the segment types it can deliver. */
export function structuredReplyInstruction(profile: AiOutboundSegmentProfile = DEFAULT_PROFILE): string {
  const { types } = profile;
  const hints = types.flatMap(type => {
    const hint = profile.extensions?.[type]?.hint;
    return hint ? [`- ${type} on this platform: ${hint}`] : [];
  });
  return [
    'Final reply: JSON matching the supplied schema, {"messages":[{"segments":[...]}]}, no fence/prose. Each item is one chat message; preserve message and segment order. Usually one message; split into 2–3 only where natural.',
    `Segment types available on this platform: ${types.join(', ')}.`,
    ...SEGMENT_GUIDE.flatMap(([covers, line]) => {
      const offered = covers.filter(type => types.includes(type));
      return offered.length ? [`- ${offered.join(' / ')}: ${line}`] : [];
    }),
    ...hints,
    'Never invent IDs or references. Business calls use their own tool schemas; this schema is only for the final answer (including the json response tool). Use {"messages":[]} only when no reply is needed.',
    ...(profile.reaction ? reactionInstruction(profile.reaction.values) : []),
  ].join('\n');
}

function reactionInstruction(values: readonly { readonly value: string; readonly label: string }[]): string[] {
  return [
    `"reaction" reacts to the message being answered: ${values.map(item => `${item.value} ${item.label}`).join(', ')}. Most replies have none ("", the default); react only occasionally, when a gesture fits better than words.`,
    'Then {"messages":[],"reaction":"<value>"} may suffice. A short message may accompany it; avoid repeating its meaning.',
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
