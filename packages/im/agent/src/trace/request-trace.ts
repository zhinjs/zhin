import { collectEnvironmentSecrets } from '../security/outbound-leak-guard.js';
import { estimatePromptTokens } from '../prompt/estimate-tokens.js';
import { scrubSecrets } from './trace-redaction.js';

export const DEFAULT_TRACE_MAX_BYTES = 64 * 1024 * 1024;
export class RequestBodyTooLargeError extends Error {
  constructor(readonly estimatedTokens: RequestTokenEstimate) { super('Request body exceeds archive capacity'); }
}

export type TraceJson = string | number | boolean | null | readonly TraceJson[] | { readonly [key: string]: TraceJson };
export type RequestBodyStatus = 'recorded' | 'disabled' | 'unsupported' | 'too_large' | 'capture_failed';
export interface TurnTraceRequestBodyInput {
  readonly system?: unknown;
  readonly messages?: readonly unknown[];
  readonly tools?: readonly { name: string; description?: string; inputSchema?: unknown }[];
  readonly output_schema?: unknown;
}
export interface TurnTraceRequestBody {
  readonly system?: string;
  readonly messages: readonly { readonly role: string; readonly content: TraceJson }[];
  readonly tools: readonly { readonly name: string; readonly description?: string; readonly input_schema: TraceJson }[];
  readonly output_schema?: TraceJson;
}
export interface RequestTokenEstimate {
  readonly system: number;
  readonly messages: number;
  readonly tools: number;
  readonly output_schema: number;
  readonly total: number;
  readonly basis: 'model_input_text';
}
export interface TurnTraceRequest {
  readonly request_id: string;
  readonly index: number;
  readonly provider: string;
  readonly model: string;
  readonly started_at: number;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  readonly duration_ms?: number;
  readonly stop_reason?: string;
  readonly body_status: RequestBodyStatus;
  readonly estimated_tokens?: RequestTokenEstimate;
  readonly body?: TurnTraceRequestBody;
}
export type TurnTraceRequestStart = Omit<TurnTraceRequest, 'index' | 'body' | 'estimated_tokens'> & {
  readonly body?: TurnTraceRequestBodyInput;
};

const secretKey = /^(?:authorization|cookie|setcookie|password|passwd|secret|token|accesstoken|refreshtoken|apikey|privatekey|credential|credentials)$/i;
const mediaType = /^(?:image|image_url|file|audio|input_audio|video|image-data|file-data|reasoning-file|media)$/;
const normalizeKey = (key: string) => key.replace(/[-_]/g, '');

/** Only model-input fields enter this projection. No transport options or headers are accepted. */
export function captureRequestBody(input: TurnTraceRequestBodyInput, secrets = collectEnvironmentSecrets(), maxBytes = DEFAULT_TRACE_MAX_BYTES): {
  body: TurnTraceRequestBody;
  estimated_tokens: RequestTokenEstimate;
  bytes: number;
} {
  const system = input.system === undefined ? undefined : systemText(input.system);
  const parts = { system: estimatePromptTokens(omitMediaText(system ?? '')),
    messages: estimateInputText(input.messages ?? []), tools: estimateInputText(input.tools ?? []),
    output_schema: input.output_schema === undefined ? 0 : estimateInputText(input.output_schema),
  };
  const estimated_tokens: RequestTokenEstimate = Object.freeze({ ...parts, total: Object.values(parts).reduce((sum, tokens) => sum + tokens, 0), basis: 'model_input_text' });
  let bytes = 64; // object keys and empty arrays
  const consume = (size: number) => { bytes += size; if (bytes > maxBytes) throw new RequestBodyTooLargeError(estimated_tokens); };
  consume(0);
  const values = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  const text = (value: string): string => {
    let result = scrubSecrets(redactTextCredentials(omitMediaText(value)))
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted]')
      .replace(/(["']?(?:token|authorization|cookie|credential)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1[redacted]');
    for (const value of values) result = result.split(value).join('[redacted]');
    return result;
  };
  const marker = (value: string) => { consume(jsonStringBytes(value)); return value; };
  const seen = new Set<object>();
  const project = (value: unknown, schema = false, sensitiveSchema = false): TraceJson => {
    if (value == null) { consume(4); return null; }
    if (typeof value === 'string') { const result = text(value); consume(jsonStringBytes(result)); return result; }
    if (typeof value === 'boolean') { consume(5); return value; }
    if (typeof value === 'number') { consume(24); return Number.isFinite(value) ? value : null; }
    if (typeof value !== 'object') return marker('[unsupported]');
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof URL) return marker('[media omitted]');
    if (seen.has(value)) throw new TypeError('Cyclic model input cannot be recorded');
    seen.add(value);
    try {
      consume(2);
      if (Array.isArray(value)) { consume(value.length); return value.map(item => project(item, schema, sensitiveSchema)); }
      const record = value as Record<string, unknown>;
      if (!schema && isMediaRecord(record)) {
        const media = { type: typeof record.type === 'string' ? record.type : 'media', omitted: 'media',
          ...(typeof record.mediaType === 'string' ? { mediaType: text(record.mediaType) } : {}) };
        consume(jsonStringBytes(media.type) + jsonStringBytes(media.mediaType ?? '') + 44);
        return media;
      }
      return Object.fromEntries(Object.entries(record).map(([key, entry]) => {
        consume(jsonStringBytes(key) + 2);
        const sensitive = secretKey.test(normalizeKey(key));
        if ((!schema && /^(?:base64|bytes)$/i.test(key))) return [key, marker('[media omitted]')];
        if (key === 'providerOptions' || key === 'providerMetadata'
          || ((!schema && sensitive) || (schema && sensitiveSchema && /^(?:default|const|enum|examples)$/.test(key)))) return [key, marker('[redacted]')];
        return [key, project(entry, schema, sensitiveSchema || (schema && sensitive))];
      }));
    } finally { seen.delete(value); }
  };
  const keptSystem = system === undefined ? undefined : text(system);
  if (keptSystem !== undefined) consume(jsonStringBytes(keptSystem));
  const body: TurnTraceRequestBody = {
    ...(keptSystem === undefined ? {} : { system: keptSystem }),
    messages: (input.messages ?? []).map(message => {
      if (!message || typeof message !== 'object') throw new TypeError('Invalid model message');
      const { role, content } = message as { role?: unknown; content?: unknown };
      if (typeof role !== 'string') throw new TypeError('Invalid model message role');
      consume(jsonStringBytes(role) + 24);
      return { role: text(role), content: project(content) };
    }),
    tools: (input.tools ?? []).map(tool => {
      consume(jsonStringBytes(tool.name) + jsonStringBytes(tool.description ?? '') + 50);
      return { name: text(tool.name),
        ...(tool.description === undefined ? {} : { description: text(tool.description) }),
        input_schema: project(tool.inputSchema, true),
      };
    }),
    ...(input.output_schema === undefined ? {} : { output_schema: project(input.output_schema, true) }),
  };
  return { body: freezeJson(body), bytes, estimated_tokens };
}

function systemText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(systemText).join('\n\n');
  if (value && typeof value === 'object' && 'content' in value && typeof value.content === 'string') return value.content;
  throw new TypeError('Unsupported system instructions');
}

// JSON string length without allocating another escaped copy of the prompt.
function jsonStringBytes(value: string): number {
  let size = Buffer.byteLength(value) + 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) size += 1;
    else if (code < 32) size += [8, 9, 10, 12, 13].includes(code) ? 1 : 5;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
      else size += 3;
    } else if (code >= 0xdc00 && code <= 0xdfff) size += 3;
  }
  return size;
}

function estimateInputText(value: unknown, seen = new Set<object>()): number {
  if (typeof value === 'string') return estimatePromptTokens(omitMediaText(value));
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return 1;
  if (typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof URL) return 0;
  if (seen.has(value)) throw new TypeError('Cyclic model input cannot be recorded');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateInputText(item, seen), 0);
    const record = value as Record<string, unknown>;
    if (isMediaRecord(record)) return 0;
    return Object.entries(record).reduce((sum, [key, entry]) => /^(?:providerOptions|providerMetadata|base64|bytes)$/.test(key)
      ? sum : sum + estimatePromptTokens(key) + estimateInputText(entry, seen), 0);
  } finally { seen.delete(value); }
}
function isMediaRecord(record: Record<string, unknown>): boolean {
  return (typeof record.type === 'string' && mediaType.test(record.type))
    || (typeof record.mimeType === 'string' && /^(?:image|audio|video)\//.test(record.mimeType) && 'data' in record);
}
function omitMediaText(value: string): string {
  const text = omitInlineMedia(value);
  // Tool results may arrive as JSON text rather than structured SDK parts.
  if (!/^[\s]*[\[{]/.test(text)) return text;
  let changed = false;
  try {
    const parsed: unknown = JSON.parse(text, (key, entry: unknown) => {
      if (/^(?:base64|bytes)$/i.test(key)) { changed = true; return '[media omitted]'; }
      if (entry && typeof entry === 'object' && isMediaRecord(entry as Record<string, unknown>)) {
        changed = true;
        return { type: 'media', omitted: 'media' };
      }
      return entry;
    });
    return changed ? JSON.stringify(parsed) : text;
  } catch { return text; }
}

function omitInlineMedia(value: string): string {
  const markers = /data:|base64:\/\//gi;
  const headerBoundary = /[\s,]/g;
  const payload = /[A-Za-z0-9+/_=-]+/y;
  const parts: string[] = [];
  let headerEnd = 0;
  let headerPayloadEnd = 0;
  let copiedUntil = 0;
  let match: RegExpExecArray | null;
  while ((match = markers.exec(value)) !== null) {
    let mediaEnd: number;
    if (match[0].toLowerCase() === 'data:') {
      // Nested prefixes share both the header boundary and payload scan.
      if (headerEnd < markers.lastIndex) {
        headerBoundary.lastIndex = markers.lastIndex;
        headerEnd = headerBoundary.exec(value)?.index ?? value.length;
        payload.lastIndex = headerEnd + 1;
        headerPayloadEnd = value[headerEnd] === ','
          && value.slice(headerEnd - 7, headerEnd).toLowerCase() === ';base64'
          && payload.test(value) ? payload.lastIndex : 0;
      }
      if (headerPayloadEnd === 0) continue;
      mediaEnd = headerPayloadEnd;
    } else {
      payload.lastIndex = markers.lastIndex;
      if (!payload.test(value)) continue;
      mediaEnd = payload.lastIndex;
    }
    // Scan overlapping markers too: an outer payload can end in the next marker's "data".
    if (match.index >= copiedUntil) parts.push(value.slice(copiedUntil, match.index), '[media omitted]');
    copiedUntil = Math.max(copiedUntil, mediaEnd);
  }
  parts.push(value.slice(copiedUntil));
  return parts.join('');
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

/** Complete quoted credentials and HTTP cookie lines must be masked before token-like patterns. */
function redactTextCredentials(value: string): string {
  return value
    .replace(/("(?:authorization|cookie|set[-_]?cookie|password|passwd|secret|token|access[-_]?token|refresh[-_]?token|api[-_]?key|private[-_]?key|credentials?)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"')
    .replace(/('(?:authorization|cookie|set[-_]?cookie|password|passwd|secret|token|access[-_]?token|refresh[-_]?token|api[-_]?key|private[-_]?key|credentials?)'\s*:\s*)'(?:\\.|[^'\\])*'/gi, "$1'[redacted]'")
    .replace(/\b((?:set-cookie|cookie)\s*[:=]\s*)[^\r\n]*/gi, '$1[redacted]')
    .replace(/(\bhttps?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
}
