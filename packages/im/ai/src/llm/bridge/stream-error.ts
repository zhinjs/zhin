/**
 * Turn an AI SDK `{ type: 'error' }` stream part into an `Error` the resilience layer
 * can classify.
 *
 * Providers report mid-stream failures as plain objects, not `Error`s: Anthropic sends
 * `{ type: 'overloaded_error', message: 'Overloaded' }`, OpenAI chat completions
 * `{ message, type: 'server_error', code }`, the OpenAI Responses API
 * `{ type: 'error', code: 'rate_limit_exceeded', message }`, Gemini interactions
 * `{ code: 503, message, status: 'UNAVAILABLE' }`. `String(object)` turned all of them
 * into "[object Object]", so a transient overload was neither retried nor re-routed.
 *
 * The payload's message, type and code are kept, an HTTP-equivalent `statusCode` is
 * inferred from the provider's error type when the payload has none, and the payload
 * itself is exposed as `data.error` (the shape AI SDK `APICallError` uses), so the
 * Google RPC reader and the billing / quota detectors see the same fields they see on
 * an HTTP error.
 */

/** Provider error types that map onto an HTTP status the classifier already understands. */
const TYPE_TO_STATUS: Readonly<Record<string, number>> = {
  // Anthropic (https://docs.anthropic.com/en/api/errors)
  overloaded_error: 529,
  api_error: 500,
  rate_limit_error: 429,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  invalid_request_error: 400,
  billing_error: 402,
  timeout_error: 504,
  // OpenAI chat completions / Responses API types and codes
  server_error: 500,
  rate_limit_exceeded: 429,
  insufficient_quota: 429,
  service_unavailable: 503,
  // Google RPC statuses (Gemini interactions stream)
  UNAVAILABLE: 503,
  INTERNAL: 500,
  RESOURCE_EXHAUSTED: 429,
  DEADLINE_EXCEEDED: 504,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  INVALID_ARGUMENT: 400,
};

/** Error raised for a provider error that arrived inside a stream (HTTP status was 200). */
export class ProviderStreamError extends Error {
  /** Inferred HTTP-equivalent status; absent when the payload gives no hint. */
  readonly statusCode?: number;
  readonly type?: string;
  readonly code?: string | number;
  /** The provider payload, as `{ error }` like `APICallError.data`. */
  readonly data: { error: unknown };

  constructor(message: string, fields: { statusCode?: number; type?: string; code?: string | number; payload: unknown }) {
    super(message);
    this.name = 'ProviderStreamError';
    if (fields.statusCode !== undefined) this.statusCode = fields.statusCode;
    if (fields.type !== undefined) this.type = fields.type;
    if (fields.code !== undefined) this.code = fields.code;
    this.data = { error: fields.payload };
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function httpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value < 600 ? value : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function streamPartError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') {
    // DeepSeek forwards only the message text of an in-stream error.
    return new ProviderStreamError(error || 'Provider stream error', { payload: { message: error } });
  }
  const outer = record(error);
  if (!outer) return new ProviderStreamError(`Provider stream error: ${String(error)}`, { payload: error });
  // `{ error: { ... } }` wrappers (OpenAI-compatible gateways) carry the details one level down.
  const payload = record(outer.error) ?? outer;
  // The Responses API tags the event itself `type: 'error'`; that says nothing about the cause.
  const type = nonEmpty(payload.type) !== 'error' ? nonEmpty(payload.type) : undefined;
  const code = typeof payload.code === 'number' || nonEmpty(payload.code) ? payload.code as string | number : undefined;
  const rpcStatus = nonEmpty(payload.status);
  const statusCode = httpStatus(payload.statusCode)
    ?? httpStatus(payload.status)
    ?? httpStatus(payload.code)
    ?? [code, type, rpcStatus].map((key) => (typeof key === 'string' ? TYPE_TO_STATUS[key] : undefined)).find((s) => s !== undefined);
  const message = nonEmpty(payload.message) ?? type ?? (typeof code === 'string' ? code : undefined) ?? safeJson(error);
  return new ProviderStreamError(message, {
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(type ? { type } : {}),
    ...(code !== undefined ? { code } : {}),
    payload,
  });
}
