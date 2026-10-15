/**
 * Arguments of an AI SDK tool call, keeping what the model actually sent when it is
 * not a JSON object.
 *
 * When the model emits arguments that do not parse (truncated JSON, prose, a bare
 * string), the AI SDK marks the call `invalid: true` and passes the raw text as
 * `input` with the parse error in `error`. Replacing that with `{}` made validation
 * complain about missing fields the model believes it sent; keeping the raw text lets
 * the tool result quote it back so the model can correct the call.
 */
import type { ToolCallInputError } from '../types/content-block.js';

export interface ToolCallInput {
  readonly arguments: Record<string, unknown>;
  readonly inputError?: ToolCallInputError;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param part  the AI SDK `tool-call` part (or a `generateText` tool call)
 * @param streamedInput  text gathered from `tool-input-delta` parts, if any
 */
export function toolCallInput(
  part: { readonly input?: unknown; readonly invalid?: boolean; readonly error?: unknown },
  streamedInput?: string,
): ToolCallInput {
  if (isObject(part.input)) return { arguments: part.input };
  const raw = typeof part.input === 'string' ? part.input : (streamedInput ?? '');
  // Some providers send no arguments at all for a parameterless tool.
  if (!raw.trim()) return { arguments: {} };
  let message: string;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isObject(parsed)) return { arguments: parsed };
    message = 'arguments must be a JSON object';
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  // The SDK's own error names the cause best (e.g. AI_InvalidToolInputError).
  if (part.invalid && part.error instanceof Error && part.error.message) message = part.error.message;
  return { arguments: {}, inputError: { raw, message } };
}
