/**
 * S6 / S18: assistant turns replay in stream order with thinking first, and keep
 * their signatures: Anthropic signed thinking ahead of text + tool_use, Gemini
 * thoughtSignature on thought and text parts. Requests run on the shared provider
 * harness; the first turn replays a literal SSE stream, the second is captured.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contextToAiSdkPrompt } from '../../src/llm/bridge/ai-sdk-messages.js';
import { createUserMessage, type AssistantMessage, type ToolResultMessage } from '../../src/llm/types/agent-message.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';
import { createProviderHarness, type MockResponse } from '../helpers/provider-harness/index.js';

const weather = { name: 'get_weather', description: 'Weather for one city.', parameters: z.object({ city: z.string() }) };

function sse(events: Array<[string | undefined, unknown]>): MockResponse {
  return { sse: events.map(([event, data]) => (event ? { event, data } : { data })) };
}

function toolResult(id: string): ToolResultMessage {
  return { role: 'toolResult', toolCallId: id, toolName: 'get_weather', content: [{ type: 'text', text: '晴' }], isError: false, timestamp: Date.now() } as ToolResultMessage;
}

async function twoTurns({ sdk, ...config }: ProviderInstanceConfig, modelId: string, first: () => MockResponse) {
  const h = createProviderHarness({ sdk, model: modelId, config });
  h.reply(first());
  const assistant = await h.complete({ system: 's', user: '上海天气？', tools: [weather] }, { maxRetries: 0 });
  const call = assistant.content.find((b) => b.type === 'toolCall') as { id: string } | undefined;
  const { body: second } = await h.capture({
    system: 's',
    messages: [createUserMessage('上海天气？'), assistant, ...(call ? [toolResult(call.id)] : [createUserMessage('继续')])],
    tools: [weather],
  });
  return { assistant, second };
}

describe('Anthropic thinking + tool use replay (S6)', () => {
  const anthropicTurn = () => sse([
    ['message_start', { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Need the weather tool.' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-1' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '我查一下。' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 1 }],
    ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"city":"上海"}' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 2 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);

  it('stores thinking first and replays signed thinking ahead of text and tool_use', async () => {
    const { assistant, second } = await twoTurns(
      { sdk: 'anthropic', apiKey: 'k', providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } } } },
      'claude-sonnet-4-5',
      anthropicTurn,
    );
    expect(assistant.content.map((b) => b.type)).toEqual(['thinking', 'text', 'toolCall']);
    const replayed = second.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(replayed.content.map((p: { type: string }) => p.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(replayed.content[0]).toMatchObject({ thinking: 'Need the weather tool.', signature: 'sig-1' });
    expect(replayed.content[2]).toMatchObject({ id: 'tu_1', name: 'get_weather', input: { city: '上海' } });
  });

  it('reorders history stored before this fix (text, thinking, tool call)', () => {
    const legacy: AssistantMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: '我查一下。' },
        { type: 'thinking', thinking: 'Need the weather tool.', providerOptions: { anthropic: { signature: 'sig-1' } } },
        { type: 'toolCall', id: 'tu_1', name: 'get_weather', arguments: { city: '上海' } },
      ],
      api: 'ai-sdk', provider: 'p', model: 'claude-sonnet-4-5', stopReason: 'toolUse', timestamp: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AssistantMessage;
    const { messages } = contextToAiSdkPrompt(
      { systemPrompt: '', messages: [createUserMessage('hi'), legacy, toolResult('tu_1')] },
      [],
      { sdk: 'anthropic' },
    );
    const parts = (messages[1]!.content as Array<{ type: string }>).map((p) => p.type);
    expect(parts).toEqual(['reasoning', 'text', 'tool-call']);
  });
});

describe('Gemini thought and text signatures (S18)', () => {
  const geminiTurn = () => sse([
    [undefined, {
      candidates: [{ content: { role: 'model', parts: [
        { text: 'Thinking about it.', thought: true, thoughtSignature: 'ts-thought' },
        { text: '上海今天晴。', thoughtSignature: 'ts-text' },
      ] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15, thoughtsTokenCount: 3 },
    }],
  ]);

  it('keeps the thoughtSignature on thought and text parts and sends both back', async () => {
    const { assistant, second } = await twoTurns({ sdk: 'google', apiKey: 'k' }, 'gemini-3.8-flash', geminiTurn);
    expect(assistant.content.map((b) => b.type)).toEqual(['thinking', 'text']);
    expect(assistant.content[0]).toMatchObject({ providerOptions: { google: { thoughtSignature: 'ts-thought' } } });
    expect(assistant.content[1]).toMatchObject({ providerOptions: { google: { thoughtSignature: 'ts-text' } } });
    const model = second.contents.find((c: { role: string }) => c.role === 'model');
    expect(model.parts).toEqual([
      { text: 'Thinking about it.', thought: true, thoughtSignature: 'ts-thought' },
      { text: '上海今天晴。', thoughtSignature: 'ts-text' },
    ]);
  });

  it('does not send Gemini signatures to other providers', () => {
    const signed: AssistantMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'x', providerOptions: { google: { thoughtSignature: 'ts' } } },
        { type: 'text', text: 'y', providerOptions: { google: { thoughtSignature: 'ts2' } } },
      ],
      api: 'ai-sdk', provider: 'p', model: 'm', stopReason: 'stop', timestamp: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AssistantMessage;
    const { messages } = contextToAiSdkPrompt({ systemPrompt: '', messages: [createUserMessage('hi'), signed, createUserMessage('again')] }, [], { sdk: 'anthropic' });
    // Anthropic protocol drops unsigned (non-Anthropic) thinking; the text keeps only Google keys, which Anthropic ignores.
    expect((messages[1]!.content as Array<{ type: string }>).map((p) => p.type)).toEqual(['text']);
  });
});
