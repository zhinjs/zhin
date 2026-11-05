import { z } from 'zod';
import { assistantAnswerText, createUserMessage } from '../../src/index.js';
import { deepSeekProvider, openAiProvider, openAiCompatibleProvider, openCodeZenProvider, anthropicProvider, googleProvider, ollamaProvider } from '../../src/providers/index.js';
import { TOOL_CALL_REASONING_PLACEHOLDER } from '../../src/llm/bridge/ai-sdk-messages.js';
import { driverFixture, prompt, chatReply } from './fixtures.js';

it.each([deepSeekProvider, openAiCompatibleProvider, openCodeZenProvider].flatMap(definition => [true, false].flatMap(thinking => [true, false].map(withReasoning => ({ name: definition.id, definition, thinking, withReasoning })))))('preserves reasoning for the real $name tool round trip (declared: $thinking, returned: $withReasoning)', async ({ definition, thinking, withReasoning }) => {
  const bodies: Array<{ messages: Array<Record<string, unknown>> }> = [];
  const f = driverFixture({ definition,
    ...(definition.id === 'openai-compatible' ? { options: { baseUrl: 'https://gateway.test/v1' } } : {}),
    model: { id: 'deepseek-reasoner', kinds: ['language'], protocol: 'openai-chat', input: ['text'], toolCalling: true, thinking },
    fetch: async (url, init) => {
      bodies.push(await new Request(url, init).json());
      return bodies.length === 1 ? Response.json({ id: 'chatcmpl-tool', object: 'chat.completion', created: 1, model: 'deepseek-reasoner',
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
          ...(withReasoning ? { reasoning_content: 'Preserved synthetic reasoning' } : {}),
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) : chatReply('done');
    } });
  const tools = [{ name: 'lookup', description: 'Lookup a synthetic value', parameters: z.object({}) }];
  const scope = await f.runtime.openScope({ context: { rootId: 'root', ownerId: 'host:test', hostOwnerId: 'host:test', operationId: 'test', sessionKey: 'test' } });
  try {
    const first = await scope.client.generate({ purpose: 'chat', request: { context: { ...prompt, tools } } });
    const expectedReasoning = withReasoning ? 'Preserved synthetic reasoning' : thinking ? TOOL_CALL_REASONING_PLACEHOLDER : undefined;
    if (expectedReasoning) expect(first.content).toContainEqual({ type: 'thinking', thinking: expectedReasoning });
    else expect(first.content.some(block => block.type === 'thinking')).toBe(false);
    expect(assistantAnswerText(first)).toBe('');
    await scope.client.generate({ purpose: 'chat', request: { context: { systemPrompt: prompt.systemPrompt, tools,
      messages: [createUserMessage('Hello'), first, { role: 'toolResult', toolCallId: 'call-1', toolName: 'lookup',
        content: [{ type: 'text', text: 'synthetic result' }], isError: false, timestamp: 1 }] } } });
    expect(bodies).toHaveLength(2);
    const history = bodies[1].messages.find(message => message.role === 'assistant');
    expect(history).toBeDefined();
    if (expectedReasoning) expect(history).toHaveProperty('reasoning_content', expectedReasoning);
    else expect(history).not.toHaveProperty('reasoning_content');
  } finally { await scope.close(); f.runtime.retire(); }
});

it.each([false, true])('preserves only real Gemini thinking and tool signatures (returned thinking: %s)', async returnedThinking => {
  const bodies: Array<{ contents: Array<{ parts: Array<Record<string, unknown>> }> }> = [];
  const f = driverFixture({ definition: googleProvider,
    model: { id: 'gemini-local', kinds: ['language'], protocol: 'google-generate-content', input: ['text'], toolCalling: true, thinking: true },
    fetch: async (url, init) => {
      bodies.push(await new Request(url, init).json());
      return Response.json({ candidates: [{ content: { role: 'model', parts: bodies.length === 1
        ? [...(returnedThinking ? [{ text: 'Real synthetic thought', thought: true, thoughtSignature: 'synthetic-thinking-signature' }] : []),
          { functionCall: { name: 'lookup', args: {} }, thoughtSignature: 'synthetic-tool-signature' }] : [{ text: 'done' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } });
    } });
  const scope = await f.runtime.openScope({ context: { rootId: 'root', ownerId: 'host:test', hostOwnerId: 'host:test', operationId: 'test', sessionKey: 'test' } });
  const tools = [{ name: 'lookup', description: 'Synthetic lookup', parameters: z.object({}) }];
  try {
    const first = await scope.client.generate({ purpose: 'chat', request: { context: { ...prompt, tools } } });
    const thoughts = first.content.filter(block => block.type === 'thinking');
    if (returnedThinking) expect(thoughts).toEqual([expect.objectContaining({ thinking: 'Real synthetic thought' })]);
    else expect(thoughts).toEqual([]);
    const call = first.content.find(block => block.type === 'toolCall');
    expect(call).toBeDefined();
    expect(call!.providerOptions).toMatchObject({ google: { thoughtSignature: 'synthetic-tool-signature' } });
    await scope.client.generate({ purpose: 'chat', request: { context: { systemPrompt: '', tools,
      messages: [createUserMessage('Hello'), first, { role: 'toolResult', toolCallId: call!.id, toolName: 'lookup',
        content: [{ type: 'text', text: 'synthetic result' }], isError: false, timestamp: 1 }] } } });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].contents.flatMap(content => content.parts)).toContainEqual(expect.objectContaining({
      functionCall: expect.objectContaining({ name: 'lookup', args: {}, id: call!.id }), thoughtSignature: 'synthetic-tool-signature',
    }));
    const replayedThoughts = bodies[1].contents.flatMap(content => content.parts).filter(part => part.thought === true);
    expect(replayedThoughts).toEqual(returnedThinking ? [{ text: 'Real synthetic thought', thought: true, thoughtSignature: 'synthetic-thinking-signature' }] : []);
  } finally { await scope.close(); f.runtime.retire(); }
});

it.each([ollamaProvider, openAiProvider].map(definition => ({ name: definition.id, definition })))('does not invent thinking on the real $name Chat tool loop', async ({ definition }) => {
  const bodies: Array<{ messages: Array<Record<string, unknown>> }> = [];
  const f = driverFixture({ definition,
    model: { id: 'native-thinking-model', kinds: ['language'], protocol: 'openai-chat', input: ['text'], toolCalling: true, thinking: true },
    fetch: async (url, init) => {
      bodies.push(await new Request(url, init).json());
      return bodies.length === 1 ? Response.json({ id: 'chatcmpl-tool', object: 'chat.completion', created: 1, model: 'native-thinking-model',
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) : chatReply('done');
    } });
  const scope = await f.runtime.openScope({ context: { rootId: 'root', ownerId: 'host:test', hostOwnerId: 'host:test', operationId: 'test', sessionKey: 'test' } });
  const tools = [{ name: 'lookup', description: 'Synthetic lookup', parameters: z.object({}) }];
  try {
    const first = await scope.client.generate({ purpose: 'chat', request: { context: { ...prompt, tools } } });
    expect(first.content.some(block => block.type === 'thinking')).toBe(false);
    await scope.client.generate({ purpose: 'chat', request: { context: { systemPrompt: '', tools,
      messages: [createUserMessage('Hello'), first, { role: 'toolResult', toolCallId: 'call-1', toolName: 'lookup',
        content: [{ type: 'text', text: 'synthetic result' }], isError: false, timestamp: 1 }] } } });
    const assistant = bodies[1].messages.find(message => message.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant).not.toHaveProperty('reasoning_content');
    expect(JSON.stringify(assistant)).not.toContain(TOOL_CALL_REASONING_PLACEHOLDER);
  } finally { await scope.close(); f.runtime.retire(); }
});

it.each([false, true])('keeps OpenAI Responses native reasoning without fabricating placeholders (opaque: %s)', async opaque => {
  const bodies: Array<{ input: Array<Record<string, unknown>> }> = [];
  const f = driverFixture({ definition: openAiProvider,
    model: { id: 'gpt-local', kinds: ['language'], protocol: 'openai-responses', input: ['text'], toolCalling: true, thinking: true },
    fetch: async (url, init) => {
      bodies.push(await new Request(url, init).json());
      return Response.json({ id: `resp-${bodies.length}`, created_at: 1, model: 'gpt-local', object: 'response', status: 'completed',
        output: bodies.length === 1 ? [
          ...(opaque ? [{ type: 'reasoning', id: 'rs-local', summary: [], encrypted_content: 'synthetic-encrypted-state' }] : []),
          { type: 'function_call', id: 'fc-local', call_id: 'call-1', name: 'lookup', arguments: '{}' },
        ] : [{ type: 'message', id: 'msg-local', role: 'assistant', content: [{ type: 'output_text', text: 'done', annotations: [] }] }],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } });
    } });
  const scope = await f.runtime.openScope({ context: { rootId: 'root', ownerId: 'host:test', hostOwnerId: 'host:test', operationId: 'test', sessionKey: 'test' } });
  const tools = [{ name: 'lookup', description: 'Synthetic lookup', parameters: z.object({}) }];
  try {
    const first = await scope.client.generate({ purpose: 'chat', request: { context: { ...prompt, tools } } });
    expect(first.content).not.toContainEqual({ type: 'thinking', thinking: TOOL_CALL_REASONING_PLACEHOLDER });
    if (opaque) expect(first.content).toContainEqual(expect.objectContaining({ type: 'thinking',
      providerOptions: { openai: { itemId: 'rs-local', reasoningEncryptedContent: 'synthetic-encrypted-state' } } }));
    else expect(first.content.some(block => block.type === 'thinking')).toBe(false);
    await scope.client.generate({ purpose: 'chat', request: { context: { systemPrompt: '', tools,
      messages: [createUserMessage('Hello'), first, { role: 'toolResult', toolCallId: 'call-1', toolName: 'lookup',
        content: [{ type: 'text', text: 'synthetic result' }], isError: false, timestamp: 1 }] } } });
    const reasoning = bodies[1].input.filter(item => item.type === 'reasoning');
    expect(reasoning).toEqual([]);
    // The installed Responses SDK uses native item references with its default
    // store=true. Codex's separate store=false regression covers encrypted replay.
    if (opaque) expect(bodies[1].input).toContainEqual({ type: 'item_reference', id: 'rs-local' });
  } finally { await scope.close(); f.runtime.retire(); }
});

it.each([false, true])('does not fabricate unsigned Anthropic thinking (declared thinking: %s)', async thinking => {
  const f = driverFixture({ definition: anthropicProvider,
    model: { id: 'configured-model', kinds: ['language'], protocol: 'anthropic-messages', input: ['text'], toolCalling: true, thinking },
    fetch: async () => Response.json({ id: 'msg-tool', type: 'message', role: 'assistant', model: 'configured-model',
      content: [{ type: 'tool_use', id: 'call-1', name: 'lookup', input: {} }], stop_reason: 'tool_use', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2 } }) });
  const result = await f.runtime.withInvocation({ context: { rootId: 'root', ownerId: 'host:test', hostOwnerId: 'host:test', operationId: 'test' }, purpose: 'chat' }, execution => execution.client.generate({ purpose: 'chat', request: {
    context: { ...prompt, tools: [{ name: 'lookup', description: 'Synthetic', parameters: z.object({}) }] },
  } }));
  expect(result.content.some(block => block.type === 'thinking')).toBe(false);
  f.runtime.retire();
});
