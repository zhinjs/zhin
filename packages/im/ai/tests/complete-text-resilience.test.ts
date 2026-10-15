/**
 * completeText parity with the main chat path (S13): resilience wrapper (retry,
 * fallback, timeout, abort) and answer-only output (never thinking).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateMock = vi.hoisted(() => vi.fn());
vi.mock('../src/llm/bridge/ai-sdk-stream.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/llm/bridge/ai-sdk-stream.js')>()),
  generateTextViaAiSdk: generateMock,
}));

import { createSdkProviderAdapter } from '../src/sdk-provider-adapter.js';
import { CompletionFailureError } from '../src/llm/convert/openai-bridge.js';
import { ProviderRequestError } from '../src/llm/provider-resilience.js';
import { EMPTY_TOKEN_USAGE, type AssistantMessage } from '../src/llm/types/agent-message.js';
import type { Model } from '../src/llm/types/model.js';
import type { StreamOptions } from '../src/llm/llm-api-runtime.js';

const FAST = { baseDelayMs: 0, maxDelayMs: 0 };

function reply(content: AssistantMessage['content'], extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'ai-sdk',
    provider: 'p',
    model: 'm',
    usage: { ...EMPTY_TOKEN_USAGE },
    stopReason: 'stop',
    timestamp: 0,
    ...extra,
  };
}

function httpError(status: number, message = `HTTP ${status}`): Error {
  return Object.assign(new Error(message), { statusCode: status });
}

function adapter(extra: Record<string, unknown> = {}) {
  const p = createSdkProviderAdapter('p', {
    sdk: 'openai',
    apiKey: 'test-key',
    models: ['primary', 'backup'],
    ...extra,
  });
  if (!p) throw new Error('adapter not created');
  return p;
}

type Call = [unknown, Model, unknown, StreamOptions | undefined];
const calls = () => generateMock.mock.calls as Call[];

beforeEach(() => {
  generateMock.mockReset();
});

describe('SdkProviderAdapter.completeText resilience', () => {
  it('retries a retryable error and disables SDK-level retries', async () => {
    generateMock
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(reply([{ type: 'text', text: '摘要' }]));

    await expect(adapter().completeText('sys', 'user', { resilience: FAST })).resolves.toBe('摘要');
    expect(calls()).toHaveLength(2);
    for (const [, model, , options] of calls()) {
      expect(model.id).toBe('primary');
      expect(options?.maxRetries).toBe(0);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('falls back to the next model after retries are exhausted', async () => {
    generateMock.mockImplementation(async (_lm: unknown, model: Model) => {
      if (model.id === 'primary') throw httpError(500);
      return reply([{ type: 'text', text: 'from backup' }]);
    });

    const text = await adapter().completeText('sys', 'user', {
      resilience: { ...FAST, maxRetries: 1 },
      fallbackModels: ['backup'],
    });
    expect(text).toBe('from backup');
    expect(calls().map(([, m]) => m.id)).toEqual(['primary', 'primary', 'backup']);
  });

  it('does not retry or fall back on a non-retryable auth error', async () => {
    generateMock.mockRejectedValue(httpError(401, 'Unauthorized'));

    await expect(adapter().completeText('sys', 'user', {
      resilience: FAST,
      fallbackModels: ['backup'],
    })).rejects.toThrow('Unauthorized');
    expect(calls()).toHaveLength(1);
  });

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController();
    generateMock.mockImplementation(async (_lm: unknown, _m: Model, _c: unknown, options?: StreamOptions) => {
      controller.abort(new Error('caller cancelled'));
      throw options?.signal?.reason ?? new Error('aborted');
    });

    await expect(adapter().completeText('sys', 'user', {
      signal: controller.signal,
      resilience: FAST,
      fallbackModels: ['backup'],
    })).rejects.toThrow('caller cancelled');
    expect(calls()).toHaveLength(1);
  });

  it('times out a hung request and reports a timeout failure', async () => {
    generateMock.mockImplementation((_lm: unknown, _m: Model, _c: unknown, options?: StreamOptions) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      }));

    const error = await adapter().completeText('sys', 'user', {
      timeoutMs: 20,
      resilience: { ...FAST, maxRetries: 1 },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).kind).toBe('timeout');
    expect(calls()).toHaveLength(2);
  });

  it('uses the provider defaultModel when no model is given', async () => {
    generateMock.mockResolvedValue(reply([{ type: 'text', text: 'ok' }]));
    await adapter({ defaultModel: 'backup' }).completeText('sys', 'user');
    expect(calls()[0]![1].id).toBe('backup');
  });

  it('forwards temperature and maxTokens', async () => {
    generateMock.mockResolvedValue(reply([{ type: 'text', text: 'ok' }]));
    await adapter().completeText('sys', 'user', { temperature: 0.3, maxTokens: 500 });
    expect(calls()[0]![3]).toMatchObject({ temperature: 0.3, maxTokens: 500 });
  });
});

describe('SdkProviderAdapter.completeText output', () => {
  it('never returns thinking as the summary', async () => {
    generateMock.mockResolvedValue(reply([{ type: 'thinking', thinking: '内部推理' }]));
    await expect(adapter().completeText('sys', 'user')).resolves.toBe('');
  });

  it('drops thinking next to the answer text', async () => {
    generateMock.mockResolvedValue(reply([
      { type: 'thinking', thinking: '内部推理' },
      { type: 'text', text: '真正的摘要' },
    ]));
    await expect(adapter().completeText('sys', 'user')).resolves.toBe('真正的摘要');
  });

  it('throws the finish error instead of returning reasoning on a content-filter stop', async () => {
    generateMock.mockResolvedValue(reply(
      [{ type: 'thinking', thinking: '内部推理' }],
      { stopReason: 'error', errorMessage: '模型因内容安全策略未生成回复（SAFETY）' },
    ));
    const error = await adapter().completeText('sys', 'user').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompletionFailureError);
    expect((error as Error).message).toBe('模型因内容安全策略未生成回复（SAFETY）');
  });
});
