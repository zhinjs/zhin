import { describe, expect, it } from 'vitest';
import { isContextOverflowError, isContextOverflowMessage } from '../../src/llm/context-overflow.js';
import { isContextOverflowError as compactionDetector } from '../../src/compaction/agent-message-compaction.js';
import { classifyProviderError } from '../../src/llm/provider-resilience.js';

function apiError(statusCode: number, message: string, responseBody?: string) {
  return Object.assign(new Error(message), {
    name: 'AI_APICallError', statusCode, responseHeaders: {}, ...(responseBody ? { responseBody } : {}),
  });
}

const OVERFLOW_MESSAGES = [
  // OpenAI
  "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
  'context_length_exceeded',
  // Anthropic
  'prompt is too long: 210000 tokens > 200000 maximum',
  // Gemini API
  'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
  // Vertex AI
  'Unable to submit request because the input token count is 1200000 but model only supports up to 1048576. Reduce the input token count and try again.',
  // Bedrock
  'Input is too long for requested model.',
  // OpenAI TPM: the request alone is bigger than the per-minute budget
  'Request too large for gpt-4o in organization org-x on tokens per min (TPM): Limit 30000, Requested 45000.',
];

const NOT_OVERFLOW_MESSAGES = [
  // OpenAI / Gemini quota: compacting cannot help, and the old `exceed.*limit` matched these.
  'You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.',
  'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0',
  'This request would exceed the rate limit for your organization of 40,000 input tokens per minute.',
  'Overloaded',
];

describe('shared context-overflow detector', () => {
  it.each(OVERFLOW_MESSAGES)('recognises %s', (text) => {
    expect(isContextOverflowMessage(text)).toBe(true);
    expect(isContextOverflowError(new Error(text))).toBe(true);
  });

  it.each(NOT_OVERFLOW_MESSAGES)('does not mistake %s for an overflow', (text) => {
    expect(isContextOverflowMessage(text)).toBe(false);
  });

  it('reads the provider body and the cause, not only the top-level message', () => {
    const body = JSON.stringify({ error: { code: 400, message: 'The input token count (2000000) exceeds the maximum number of tokens allowed (1048576).', status: 'INVALID_ARGUMENT' } });
    expect(isContextOverflowError(apiError(400, 'Bad Request', body))).toBe(true);
    expect(isContextOverflowError(new Error('wrapped', { cause: new Error('prompt is too long: 5 tokens > 4 maximum') }))).toBe(true);
    expect(isContextOverflowError({ name: 'AI_RetryError', message: 'Failed after 3 attempts', lastError: new Error('context_length_exceeded') })).toBe(true);
  });

  it('is the same detector the compaction path uses', () => {
    expect(compactionDetector).toBe(isContextOverflowError);
  });

  it('classifies Gemini and Anthropic overflows as context_overflow (no retry, no fallback)', () => {
    for (const text of OVERFLOW_MESSAGES.slice(2, 5)) {
      const info = classifyProviderError(apiError(400, text));
      expect(info).toMatchObject({ kind: 'context_overflow', retryable: false, fallbackEligible: false });
    }
  });
});
