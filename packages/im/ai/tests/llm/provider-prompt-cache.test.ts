import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicMessages, createProviderHarness } from '../helpers/provider-harness/index.js';
import { generateTextViaAiSdk } from '../../src/llm/bridge/ai-sdk-stream.js';
import { createUserMessage, EMPTY_TOKEN_USAGE, type AgentMessage } from '../../src/llm/types/agent-message.js';
import { createPromptContextBlock, projectPromptContext } from '../../src/memory/prompt-context.js';

describe('Anthropic history cache transport', () => {
  it.each([true, false])('sends a history breakpoint through the real SDK (stream=%s)', async stream => {
    const h = createProviderHarness({ sdk: 'anthropic', model: 'claude-3-7-sonnet-20250219' })
      .reply(anthropicMessages.reply({ text: 'ok' }));
    const input = { system: 'stable', user: 'hello', tools: [{ name: 'lookup', description: 'lookup', parameters: z.object({}) }] };
    if (stream) await h.complete(input);
    else await generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, h.context(input));
    const body = h.lastRequest().body as Record<string, any>;
    expect(body.system.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('reuses an unchanged history prefix and preserves signed tool-call/result adjacency', async () => {
    const h = createProviderHarness({ sdk: 'anthropic', model: 'claude-3-7-sonnet-20250219' })
      .reply(anthropicMessages.reply({ text: 'ok' }))
      .reply(anthropicMessages.reply({ text: 'ok again' }));
    const first = { ...createUserMessage('first'), content: [
      { type: 'text' as const, text: 'time-1' }, createPromptContextBlock('rules', 'A very long stable rule body. '.repeat(40)),
    ] };
    const call: AgentMessage = {
      role: 'assistant', timestamp: 1, api: 'ai-sdk', provider: 'fixture', model: 'm', usage: EMPTY_TOKEN_USAGE, stopReason: 'toolCalls',
      content: [{ type: 'thinking', thinking: 'reason', providerOptions: { anthropic: { signature: 'signature' } } },
        { type: 'toolCall', id: 'c', name: 'lookup', arguments: {} }],
    };
    const result: AgentMessage = { role: 'toolResult', toolCallId: 'c', toolName: 'lookup', timestamp: 1, isError: false, content: [{ type: 'text', text: 'found' }] };
    const context = h.context({ system: 'stable', user: 'hello', tools: [{ name: 'lookup', description: 'lookup', parameters: z.object({}) }] });
    context.messages = projectPromptContext([first, call, result]);
    await h.runtime.complete(h.model, context);
    const before = h.lastRequest().body as Record<string, any>;
    context.messages = projectPromptContext([first, call, result, { ...first, content: [{ type: 'text', text: 'time-2' }, first.content[1]!] }]);
    await h.runtime.complete(h.model, context);
    const after = h.lastRequest().body as Record<string, any>;
    const stripCache = (value: unknown): unknown => Array.isArray(value) ? value.map(stripCache)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cache_control').map(([key, child]) => [key, stripCache(child)])) : value;
    // The SDK can merge adjacent user/tool-result messages; compare the actual old content prefix.
    expect(stripCache(after.messages.slice(0, 2))).toEqual(stripCache(before.messages.slice(0, 2)));
    expect(stripCache(after.messages[2].content.slice(0, before.messages[2].content.length))).toEqual(stripCache(before.messages[2].content));
    expect(JSON.stringify(after).split('A very long stable rule body.').length - 1).toBe(40);
    expect(JSON.stringify(after)).not.toContain('contextRef');
    expect(after.messages[1].content[0]).toMatchObject({ type: 'thinking', signature: 'signature' });
    expect(after.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'c' });
  });

  it('keeps cache disabled when requested', async () => {
    const h = createProviderHarness({ sdk: 'anthropic' }).reply(anthropicMessages.reply({ text: 'ok' }));
    await h.complete({ system: 'stable', user: 'hello' }, { promptCache: false });
    expect(JSON.stringify(h.lastRequest().body)).not.toContain('cache_control');
  });
});


// Wire-prefix fixture: exact serialized block prefixes, not simulated billing or
// evidence of a live server hit. Include tools/system so changes cannot masquerade
// as a history cache hit. cache_control config itself is not prompt content.
function cachePrefixes(body: Record<string, any>): string[] {
  const prefixes: string[] = [];
  const blocks: unknown[] = [];
  for (const [scope, values] of [
    ['tools', body.tools ?? []], ['system', body.system ?? []],
    ...body.messages.map((m: any) => [m.role, m.content]),
  ]) {
    for (const value of values) {
      const { cache_control, ...content } = value;
      blocks.push({ scope, content });
      if (cache_control) prefixes.push(JSON.stringify(blocks));
    }
  }
  return prefixes;
}

it.each([true, false])('retains the previous written history prefix beyond 20 new blocks (stream=%s)', async stream => {
  const h = createProviderHarness({ sdk: 'anthropic', model: 'claude-3-7-sonnet-20250219' });
  const tools = [{ name: 'lookup', description: 'lookup', parameters: z.object({}) }];
  const first = createUserMessage('stable long input '.repeat(1000));
  const request = async (messages: AgentMessage[]) => {
    h.reply(anthropicMessages.reply({ text: 'ok' }));
    const context = h.context({ system: 'stable', messages, tools });
    if (stream) await h.runtime.complete(h.model, context);
    else await generateTextViaAiSdk(h.runtime.resolveLanguageModel(h.alias, h.modelId)!, h.model, context);
    return h.lastRequest().body as Record<string, any>;
  };
  const answer = (text: string): AgentMessage => ({ role: 'assistant', timestamp: 1, api: 'ai-sdk', provider: 'mock', model: 'm',
    usage: EMPTY_TOKEN_USAGE, stopReason: 'stop', content: [{ type: 'text', text }] });
  const firstWire = await request([first]);
  const incoming = { ...createUserMessage(''), content: Array.from({ length: 25 }, (_, i) => ({ type: 'text' as const, text: `new block ${i}` })) };
  const secondMessages = [first, answer('first answer'), incoming];
  const secondWire = await request(secondMessages);
  expect(secondWire.messages.at(-1).content).toHaveLength(25);
  expect(cachePrefixes(secondWire)).toHaveLength(4);
  // This prefix was actually marked in request one and is explicitly retried at
  // the same position in request two, outside the final marker's lookback range.
  expect(cachePrefixes(secondWire)).toContain(cachePrefixes(firstWire).at(-1));
  expect(secondWire.messages[0].content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  const thirdWire = await request([...secondMessages, answer('second answer'), incoming]);
  expect(cachePrefixes(thirdWire)).toHaveLength(4);
  expect(cachePrefixes(thirdWire)).toContain(cachePrefixes(secondWire).at(-1));
  expect(JSON.stringify(first)).not.toContain('cacheControl');
});

it('retains the prior tool-result cache boundary before a long signed assistant response', async () => {
  const h = createProviderHarness({ sdk: 'anthropic', model: 'claude-3-7-sonnet-20250219' });
  const first = createUserMessage('stable input '.repeat(1000));
  const call: AgentMessage = { role: 'assistant', timestamp: 1, api: 'ai-sdk', provider: 'mock', model: 'm', usage: EMPTY_TOKEN_USAGE, stopReason: 'toolCalls',
    content: [{ type: 'toolCall', id: 'old', name: 'lookup', arguments: {} }] };
  const result: AgentMessage = { role: 'toolResult', toolCallId: 'old', toolName: 'lookup', timestamp: 1, isError: false,
    content: [{ type: 'text', text: 'tool result' }] };
  const longCall: AgentMessage = { ...call, content: [
    { type: 'thinking', thinking: 'reason', providerOptions: { anthropic: { signature: 'signature' } } },
    ...Array.from({ length: 25 }, (_, i) => ({ type: 'text' as const, text: `step ${i}` })),
    { type: 'toolCall', id: 'new', name: 'lookup', arguments: {} },
  ] };
  const tools = [{ name: 'lookup', description: 'lookup', parameters: z.object({}) }];
  h.reply(anthropicMessages.reply({ text: 'ok' }));
  await h.complete({ system: 'stable', messages: [first, call, result], tools });
  const before = h.lastRequest().body as Record<string, any>;
  h.reply(anthropicMessages.reply({ text: 'ok' }));
  await h.complete({ system: 'stable', messages: [first, call, result, longCall, { ...result, toolCallId: 'new' }], tools });
  const after = h.lastRequest().body as Record<string, any>;
  expect(cachePrefixes(after)).toHaveLength(4);
  expect(cachePrefixes(after)).toContain(cachePrefixes(before).at(-1));
  expect(after.messages[3].content[0]).toMatchObject({ type: 'thinking', signature: 'signature' });
  expect(after.messages[3].content[0]).not.toHaveProperty('cache_control');
  expect(after.messages[4].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'new' });
});
