import { describe, expect, it, vi } from 'vitest';
import { LlmApiRuntime, type AssistantStreamEvent } from '../../src/llm/llm-api-runtime.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '../../src/llm/types/agent-message.js';
import type { Model } from '../../src/llm/types/model.js';
import { createResilientCompletionPort } from '../../src/llm/provider-resilience.js';

const model: Model = { id: 'test', provider: 'test', api: 'ai-sdk', sdk: 'openai', reasoning: false,
  input: ['text'], contextWindow: 8192, maxTokens: 1000 };
const message: AssistantMessage = { role: 'assistant', api: 'ai-sdk', provider: 'test', model: 'test',
  content: [{ type: 'text', text: 'first second' }], usage: EMPTY_TOKEN_USAGE, timestamp: 0, stopReason: 'stop' };

describe('completion deltas', () => {
  it('observes genuine provider deltas before the completion has resolved', async () => {
    const runtime = new LlmApiRuntime();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    runtime.registerApiProvider({ api: 'ai-sdk', stream: () => ({
      subscribe: () => () => {},
      async *[Symbol.asyncIterator](): AsyncGenerator<AssistantStreamEvent> {
        yield { type: 'text_delta', text: 'first' };
        await gate;
        yield { type: 'text_delta', text: ' second' };
        yield { type: 'done', message };
      },
    }) });
    const chunks: string[] = [];
    const result = runtime.complete(model, { systemPrompt: '', messages: [] }, { onTextDelta: value => chunks.push(value) });
    await vi.waitFor(() => expect(chunks).toEqual(['first']));
    release();
    expect(await result).toBe(message);
    expect(chunks).toEqual(['first', ' second']);
  });

  it('does not regenerate a request after its owner has committed partial output', async () => {
    const failed = Object.assign(new Error('HTTP 503'), { statusCode: 503 });
    let committed = false;
    const complete = vi.fn(async () => { committed = true; throw failed; });
    const port = createResilientCompletionPort({ complete, completeSimple: complete }, {
      config: { maxRetries: 2, requestTimeoutMs: 0 }, sleep: async () => {},
    });
    await expect(port.complete(model, { systemPrompt: '', messages: [] }, { retryAllowed: () => !committed })).rejects.toBe(failed);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
