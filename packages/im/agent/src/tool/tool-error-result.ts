/**
 * Tools that report failure in their return value instead of throwing (#1250 `tool-error-result-marked-ok`).
 *
 * Many tools catch their own errors and return `{ error: '…' }` (the speech tools do), and MCP tools return
 * a `CallToolResult` with `isError: true`. Both execution gateways (`TurnToolRuntime`, the legacy
 * `ToolRuntime`) treat such a result like a thrown failure: the journal records `tool_failed` (trace,
 * collaboration tool stats), the model reads it as a failed call, and one warn line goes to the instance log.
 *
 * Conservative on purpose: only a plain object whose `error` is a non-empty string (or an Error / an object
 * with a non-empty `message`), or an MCP result with `isError: true`, is a failure. `error: null`,
 * `error: ''`, `error: false`, arrays, strings and results that also say `ok: true` / `success: true` are not.
 */
import { getLogger } from '@zhin.js/logger';
import { redactSecretText } from '../decision-events.js';

const logger = getLogger('ToolSystem');

/** Longest error text kept from a tool's error result (journal, model, log). */
const MAX_ERROR_RESULT_CHARS = 2000;
/** Longest error text in the warn log line. */
const MAX_LOGGED_ERROR_CHARS = 300;

/** The error a tool reported in its result, or `undefined` when the result is not an error result. */
export function toolErrorResultMessage(output: unknown): string | undefined {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  if (record.ok === true || record.success === true) return undefined;
  const error = errorText(record.error);
  if (error) return clip(error, MAX_ERROR_RESULT_CHARS);
  if (record.isError === true) {
    return clip(mcpContentText(record.content) || 'the tool reported an error', MAX_ERROR_RESULT_CHARS);
  }
  return undefined;
}

/** One warn line for a tool's error result; the text is redacted and clipped. Never throws. */
export function logToolErrorResult(toolName: string, error: string): string {
  const redacted = redactSecretText(error);
  try {
    logger.warn(`tool ${toolName} returned an error result: ${clip(redacted, MAX_LOGGED_ERROR_CHARS)}`);
  } catch {
    // Logging never changes the outcome.
  }
  return redacted;
}

function errorText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value instanceof Error) return value.message.trim() || value.name;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return undefined;
}

function mcpContentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      ? String((block as { text?: unknown }).text ?? '')
      : '')
    .filter((text) => text.trim())
    .join('\n')
    .trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
