import { describe, expect, it, vi, beforeEach } from 'vitest';
import { streamText, type LanguageModel } from 'ai';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: vi.fn(),
    generateText: vi.fn(),
  };
});

import { createAiSdkStreamFn } from '../../src/llm/bridge/ai-sdk-stream.js';
import { registerLanguageModel, clearLanguageModelStoreForTests } from '../../src/llm/language-model-store.js';
import { createContext, createUserMessage } from '../../src/llm/index.js';
import type { Model } from '../../src/llm/types/model.js';
import type { AssistantMessage } from '../../src/llm/types/agent-message.js';

const model: Model = {
  id: 'm1',
  provider: 'test',
  api: 'ai-sdk',
  sdk: 'openai',
  baseUrl: 'http://localhost',
  input: ['text'],
  contextWindow: 8192,
  maxTokens: 1024,
} as Model;

function makeStreamResult(final: Record<string, unknown>) {
  return {
    fullStream: (async function* () { /* no deltas */ })(),
    then(resolve: (value: unknown) => unknown) {
      return resolve(final);
    },
  };
}

function makeFinal(overrides: Record<string, unknown> = {}) {
  return {
    response: { messages: [] },
    text: 'plain text',
    reasoningText: '',
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    ...overrides,
  };
}

async function runStream(options?: Record<string, unknown>): Promise<AssistantMessage> {
  const fn = createAiSdkStreamFn();
  const eventStream = fn(model, createContext('sys', [createUserMessage('hi')]), options);
  let message: AssistantMessage | undefined;
  for await (const event of eventStream) {
    if (event.type === 'done' && event.message) message = event.message;
  }
  if (!message) throw new Error('no assistant message');
  return message;
}

describe('createAiSdkStreamFn outputSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLanguageModelStoreForTests();
    registerLanguageModel('test', 'm1', {} as LanguageModel);
  });

  it('passes Output.object to streamText and serializes structured output as assistant text', async () => {
    const structured = { segments: [{ type: 'text', data: { text: 'hi' } }] };
    vi.mocked(streamText).mockReturnValue(makeStreamResult(makeFinal({ output: structured })) as never);

    const schema = { type: 'object', properties: { segments: { type: 'array' } } };
    const message = await runStream({ outputSchema: schema });

    const callArgs = vi.mocked(streamText).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.output).toBeDefined();
    const textBlock = message.content.find((b) => b.type === 'text');
    expect(textBlock).toEqual({ type: 'text', text: JSON.stringify(structured) });
  });

  it('omits output and keeps plain text when outputSchema is not set', async () => {
    vi.mocked(streamText).mockReturnValue(makeStreamResult(makeFinal()) as never);

    const message = await runStream();

    const callArgs = vi.mocked(streamText).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.output).toBeUndefined();
    const textBlock = message.content.find((b) => b.type === 'text');
    expect(textBlock).toEqual({ type: 'text', text: 'plain text' });
  });

  it('falls back to plain text when structured output is unavailable (tool-call step)', async () => {
    vi.mocked(streamText).mockReturnValue(makeStreamResult(makeFinal({
      output: Promise.reject(new Error('NoObjectGenerated')),
    })) as never);

    const message = await runStream({ outputSchema: { type: 'object' } });

    const textBlock = message.content.find((b) => b.type === 'text');
    expect(textBlock).toEqual({ type: 'text', text: 'plain text' });
  });
});
