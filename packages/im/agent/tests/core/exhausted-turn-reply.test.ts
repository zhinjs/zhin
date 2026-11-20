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

it.each(['en', 'zh-CN'] as const)('uses captured %s only as the summary fallback and for fixed failure text', async locale => {
  const complete = vi.fn(async (_model: Model, _context: Context) => textReply('用户自定义生成内容'));
  const input = { locale, transport: transportReturning(complete), model, systemPrompt: 'unchanged cached prefix', messages: [], maxIterations: 3 };
  const generated = await summarizeExhaustedTurn(input);
  expect(generated.reply).toBe('用户自定义生成内容');
  expect(complete.mock.calls[0][1].systemPrompt).toBe('unchanged cached prefix');
  const instruction = JSON.stringify(complete.mock.calls[0][1].messages.at(-1));
  expect(instruction).toContain(`Reply language fallback: ${locale}.`);
  expect(instruction).toContain('applicable explicit reply-language request first');
  expect(instruction).toContain('actual request, not framework notices');
  complete.mockRejectedValueOnce(new Error('synthetic unavailable'));
  const failed = await summarizeExhaustedTurn(input);
  expect(failed.assistant).toBeUndefined();
  if (locale === 'en') expect(failed.reply).toContain('Reply "continue"');
  else expect(failed.reply).toBe(EXHAUSTED_TURN_FALLBACK_REPLY);
  expect(failed.reply).not.toContain('synthetic unavailable');
});

describe('#1250 batch 29 review: exhausted-turn summary input', () => {
  it('does not re-send base64 the model wrote earlier in the turn', async () => {
    const payload = Buffer.alloc(3000, 3).toString('base64');
    const complete = vi.fn(async (_model: Model, _context: Context) => textReply('做到一半，要继续吗？'));
    await summarizeExhaustedTurn({
      transport: transportReturning(complete),
      model,
      systemPrompt: 'system',
      messages: [textReply(`先发 data:audio/mpeg;base64,${payload}`)],
      maxIterations: 3,
    });
    const sent = JSON.stringify(complete.mock.calls[0]![1].messages);
    expect(sent).toContain('[已省略 内嵌 audio/mpeg 数据（4000 字符），未提供给模型]');
    expect(sent).not.toContain(payload.slice(0, 64));
  });
});

it('names the /language setting instead of the fallback when the user set it (#1250 b69)', async () => {
  const complete = vi.fn(async (_model: Model, _context: Context) => textReply('Here is where we are.'));
  await summarizeExhaustedTurn({ locale: 'en', localeSetByUser: true, transport: transportReturning(complete), model,
    systemPrompt: 'unchanged cached prefix', messages: [], maxIterations: 3 });
  const instruction = JSON.stringify(complete.mock.calls[0][1].messages.at(-1));
  expect(instruction).toContain('Reply language (set by the user with /language): en.');
  expect(instruction).not.toContain('Reply language fallback:');
  expect(complete.mock.calls[0][1].systemPrompt).toBe('unchanged cached prefix');
});
