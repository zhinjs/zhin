import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicMessages, createProviderHarness, openaiChat } from '../helpers/provider-harness/index.js';
import { generateTextViaAiSdk } from '../../src/llm/bridge/ai-sdk-stream.js';

const outputSchema = {
  type: 'object', properties: { answer: { type: 'string' } },
  required: ['answer'], additionalProperties: false,
};

// Only HTTP is mocked. These tests exercise the installed MiniMax/Anthropic
// SDK's synthetic JSON tool, including its suppression of ordinary text.
describe.each(['minimax', 'anthropic'] as const)('%s structured response transport', sdk => {
  it.each([true, false])('decodes the response tool without dispatching it (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk, model: sdk === 'minimax' ? 'minimax-m3' : 'claude-3-7-sonnet-20250219' })
      .reply(anthropicMessages.reply({ toolCalls: [{ name: 'json', arguments: { answer: '完成' } }] }));
    const input = { system: 'Return an object.', user: 'hello' };
    const message = stream ? await h.complete(input, { outputSchema })
      : await generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, h.context(input), { outputSchema });
    expect(message.content).toEqual([{ type: 'text', text: '{"answer":"完成"}' }]);
    expect(h.lastRequest().body.tools).toContainEqual(expect.objectContaining({ name: 'json', input_schema: outputSchema }));
  });

  it('limits JSON text compatibility to MiniMax', async () => {
    const h = createProviderHarness({ sdk, model: sdk === 'minimax' ? 'minimax-m3' : 'claude-3-7-sonnet-20250219' })
      .reply(anthropicMessages.reply({ blocks: [{ type: 'thinking', thinking: 'private', signature: 'sig' }], text: '{"answer":"完成"}' }));
    if (sdk === 'minimax') {
      const message = await h.complete('hello', { outputSchema });
      expect(message.content.filter(b => b.type === 'text')).toEqual([{ type: 'text', text: '{"answer":"完成"}' }]);
    } else {
      await expect(h.complete('hello', { outputSchema })).rejects.toThrow('requested structured output');
    }
  });

  it('preserves business tool calls before the final response', async () => {
    const h = createProviderHarness({ sdk, model: sdk === 'minimax' ? 'minimax-m3' : 'claude-3-7-sonnet-20250219' })
      .reply(anthropicMessages.reply({ toolCalls: [{ name: 'lookup', arguments: { name: 'Alice' } }] }));
    const message = await h.complete({ user: 'hello', tools: [{ name: 'lookup', description: 'Find member', parameters: z.object({ name: z.string() }) }] }, { outputSchema });
    expect(message.content).toContainEqual(expect.objectContaining({ type: 'toolCall', name: 'lookup', arguments: { name: 'Alice' } }));
  });
});

// MiniMax may send the final object as text even though the SDK supplied `json`.
describe('MiniMax JSON text compatibility', () => {
  it.each([true, false])('recovers complete JSON text without exposing thinking (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk: 'minimax' }).reply(anthropicMessages.reply({
      blocks: [{ type: 'thinking', thinking: 'private reasoning', signature: 'sig' }], text: '{"answer":"完成"}',
    }));
    const message = stream ? await h.complete('hello', { outputSchema })
      : await generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, h.context('hello'), { outputSchema });
    expect(message.content.filter(b => b.type === 'text')).toEqual([{ type: 'text', text: '{"answer":"完成"}' }]);
  });

  it.each([
    ['a leading sentence', '菜单来了，选一个{"answer":"ok"}'],
    ['a code fence', '```json\n{"answer":"ok"}\n```'],
    ['a missing closing brace', '{"answer":"ok"'],
    ['extra closing brackets', '{"answer":"ok"}]}'],
    ['a stray closer inside', '{"answer":"ok"]}'],
  ])('repairs JSON text with %s', async (_label, text) => {
    const h = createProviderHarness({ sdk: 'minimax' }).reply(anthropicMessages.reply({ text }));
    const message = await h.complete('hello', { outputSchema });
    expect(message.content.filter(b => b.type === 'text')).toEqual([{ type: 'text', text: '{"answer":"ok"}' }]);
  });

  it('passes a plain prose answer through as text', async () => {
    const h = createProviderHarness({ sdk: 'minimax' }).reply(anthropicMessages.reply({ text: '知道了，就这么办。' }));
    const message = await h.complete('hello', { outputSchema });
    expect(message.content.filter(b => b.type === 'text')).toEqual([{ type: 'text', text: '知道了，就这么办。' }]);
  });

  it.each(['{"answer":', '{"answer":"unterminated'])('rejects %j, which cannot be repaired', async text => {
    const h = createProviderHarness({ sdk: 'minimax' }).reply(anthropicMessages.reply({ text }));
    await expect(h.complete('hello', { outputSchema })).rejects.toThrow('requested structured output');
  });

  it('does not interpret thinking-only JSON as an answer', async () => {
    const h = createProviderHarness({ sdk: 'minimax' }).reply(anthropicMessages.reply({ blocks: [{ type: 'thinking', thinking: '{"answer":"private"}', signature: 'sig' }] }));
    await expect(h.complete('hello', { outputSchema })).rejects.toThrow('requested structured output');
  });
});

// DeepSeek's thinking models answer only whitespace in JSON mode; the schema goes into the prompt.
describe('prompt-mode structured output', () => {
  const systemOf = (body: Record<string, any>) => (body.messages as Array<{ role: string; content: unknown }>)
    .filter(message => message.role === 'system').map(message => String(message.content)).join('\n');

  it.each([true, false])('asks DeepSeek by instruction and decodes the answer text (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk: 'deepseek' }).reply(openaiChat.reply({ text: '好的\n```json\n{"answer":"完成"}\n```' }));
    const input = { system: 'Return an object.', user: 'hello' };
    const message = stream ? await h.complete(input, { outputSchema })
      : await generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, h.context(input), { outputSchema });
    expect(message.content.filter(b => b.type === 'text')).toEqual([{ type: 'text', text: '{"answer":"完成"}' }]);
    const body = h.lastRequest().body as Record<string, any>;
    expect(body.response_format).toBeUndefined();
    expect(systemOf(body)).toContain('Return an object.');
    expect(systemOf(body)).toContain(JSON.stringify(outputSchema));
  });

  it('passes a prose answer through for the caller to judge', async () => {
    const h = createProviderHarness({ sdk: 'deepseek' }).reply(openaiChat.reply({ text: '知道了' }));
    const message = await h.complete('hello', { outputSchema });
    expect(message.content.filter(b => b.type === 'text')).toEqual([{ type: 'text', text: '知道了' }]);
  });

  it('follows compat.structuredOutput in both directions', async () => {
    const prompt = createProviderHarness({ sdk: 'openai-compatible', config: { compat: { structuredOutput: 'prompt' } } })
      .reply(openaiChat.reply({ text: '{"answer":"完成"}' }));
    await prompt.complete('hello', { outputSchema });
    expect((prompt.lastRequest().body as Record<string, any>).response_format).toBeUndefined();

    const native = createProviderHarness({ sdk: 'deepseek', config: { compat: { structuredOutput: 'native' } } })
      .reply(openaiChat.reply({ text: '{"answer":"完成"}' }));
    await native.complete('hello', { outputSchema });
    expect((native.lastRequest().body as Record<string, any>).response_format).toBeDefined();
  });

  it('leaves requests without a schema untouched', async () => {
    const h = createProviderHarness({ sdk: 'deepseek' }).reply(openaiChat.reply({ text: 'plain' }));
    await h.complete({ system: 'Be brief.', user: 'hello' });
    expect(systemOf(h.lastRequest().body as Record<string, any>)).toBe('Be brief.');
  });
});
