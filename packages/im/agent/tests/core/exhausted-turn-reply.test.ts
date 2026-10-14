import { describe, expect, it, vi } from 'vitest';
import { EMPTY_TOKEN_USAGE, type AssistantMessage, type Context, type LlmCompletionPort, type Model } from '@zhin.js/ai';
import {
  EXHAUSTED_TURN_FALLBACK_REPLY,
  summarizeExhaustedTurn,
} from '../../src/core/exhausted-turn-reply.js';

const model = { id: 'mock-model', api: 'ai-sdk', provider: 'mock' } as unknown as Model;

function textReply(text: string, errorMessage?: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'ai-sdk',
    provider: 'mock',
    model: 'mock-model',
    usage: { ...EMPTY_TOKEN_USAGE },
    stopReason: errorMessage ? 'error' : 'stop',
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function transportReturning(complete: LlmCompletionPort['complete']): LlmCompletionPort {
  return { complete, completeSimple: complete };
}

describe('summarizeExhaustedTurn', () => {
  it('calls the model with tools disabled and returns its summary', async () => {
    const complete = vi.fn(async (_model: Model, _context: Context) => textReply('查了 dice 命令，还差改输出格式，要继续吗？'));

    const result = await summarizeExhaustedTurn({
      transport: transportReturning(complete),
      model,
      systemPrompt: 'system',
      messages: [],
      maxIterations: 15,
    });

    expect(result.reply).toBe('查了 dice 命令，还差改输出格式，要继续吗？');
    expect(result.assistant?.content).toEqual([{ type: 'text', text: result.reply }]);
    const context = complete.mock.calls[0][1];
    expect(context.tools).toBeUndefined();
    const instruction = context.messages.at(-1);
    expect(JSON.stringify(instruction)).toContain('15 tool-call steps');
  });

  it('falls back to the fixed message when the call throws', async () => {
    const result = await summarizeExhaustedTurn({
      transport: transportReturning(async () => {
        throw new Error('rate limited');
      }),
      model,
      systemPrompt: 'system',
      messages: [],
      maxIterations: 15,
    });

    expect(result).toEqual({ reply: EXHAUSTED_TURN_FALLBACK_REPLY });
  });

  it('falls back when the model returns an error or empty text', async () => {
    for (const reply of [textReply('', 'upstream 500'), textReply('   ')]) {
      const result = await summarizeExhaustedTurn({
        transport: transportReturning(async () => reply),
        model,
        systemPrompt: 'system',
        messages: [],
        maxIterations: 15,
      });
      expect(result.reply).toBe(EXHAUSTED_TURN_FALLBACK_REPLY);
      expect(result.assistant).toBeUndefined();
    }
  });

  it('gives up after the timeout instead of hanging the turn', async () => {
    const result = await summarizeExhaustedTurn({
      transport: transportReturning((_model, _context, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
      })),
      model,
      systemPrompt: 'system',
      messages: [],
      maxIterations: 15,
      timeoutMs: 20,
    });

    expect(result.reply).toBe(EXHAUSTED_TURN_FALLBACK_REPLY);
  });
});
