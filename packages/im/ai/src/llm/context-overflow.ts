/**
 * One detector for "the prompt does not fit the model's context window", shared by
 * the resilience layer (classifies it as `context_overflow`: no retry, no fallback)
 * and the agent loop (compacts the history and re-asks once).
 *
 * Each pattern is tied to a provider wording; broad phrases such as "exceed ... limit"
 * are deliberately absent because quota and rate-limit errors use them too
 * ("You exceeded your current quota", "exceeded the rate limit"), and compacting the
 * history cannot fix those.
 */

import { ProviderResponseError } from './provider-error-facts.js';

const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  // OpenAI / DeepSeek / Mistral / openai-compatible: "maximum context length is N tokens", code context_length_exceeded.
  /context[_ .-]?length/i,
  /maximum context/i,
  /context[_ ]window/i,
  // Anthropic: "prompt is too long: 210000 tokens > 200000 maximum". Bedrock: "Input is too long for requested model".
  /prompt is too long/i,
  /input is too long/i,
  /too many tokens/i,
  /\btoken[_ ]limit\b/i,
  // Gemini API: "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)."
  /input token count \(\d+\) exceeds the maximum number of tokens allowed/i,
  // Vertex AI: "Unable to submit request because the input token count is N but model only supports up to M."
  /input token count is \d+ but (?:the )?model only supports up to/i,
  // OpenAI: "Request too large for gpt-4o ... tokens per min": the request alone exceeds the
  // per-minute token budget, so only a smaller request can succeed.
  /request too large/i,
];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

/** Follow the existing error boundary once, including explicit safe classification. */
function hasContextOverflow(error: unknown, depth = 0): boolean {
  if (error instanceof ProviderResponseError) return error.classification.kind === 'context_overflow';
  if (typeof error === 'string') return isContextOverflowMessage(error);
  const rec = record(error);
  if (!rec) return error !== undefined && error !== null && isContextOverflowMessage(String(error));
  const texts: string[] = [];
  if (typeof rec.message === 'string') texts.push(rec.message);
  // AI SDK APICallError keeps the raw body; providers often put the precise wording there.
  if (typeof rec.responseBody === 'string') texts.push(rec.responseBody);
  const bodyMessage = record(record(rec.data)?.error)?.message;
  if (typeof bodyMessage === 'string') texts.push(bodyMessage);
  if (texts.some(isContextOverflowMessage)) return true;
  // AI SDK RetryError wraps the real failure in lastError; ours wrap it in cause.
  if (depth < 3) {
    for (const nested of [rec.lastError, rec.cause]) {
      if (nested !== undefined && hasContextOverflow(nested, depth + 1)) return true;
    }
  }
  return false;
}

/** True when `text` reads like a context-window overflow from any supported provider. */
export function isContextOverflowMessage(text: string): boolean {
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(text));
}

/** True when the error (or its body / cause) reports a context-window overflow. */
export function isContextOverflowError(error: unknown): boolean {
  return hasContextOverflow(error);
}
