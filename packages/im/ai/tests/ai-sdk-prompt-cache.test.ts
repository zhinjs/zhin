import { describe, it, expect } from 'vitest';
import {
  applyPromptCacheToTools,
  applyPromptCacheToMessages,
  buildPromptCacheKey,
  buildPromptCacheProviderOptions,
  isStreamPromptCacheEnabled,
  wrapSystemForPromptCache,
} from '../src/llm/bridge/ai-sdk-prompt-cache.js';
import { RUNTIME_CONTEXT_MARKER } from '../src/llm/types/runtime-context.js';

describe('ai-sdk-prompt-cache', () => {
  it('isStreamPromptCacheEnabled 默认启用', () => {
    expect(isStreamPromptCacheEnabled()).toBe(true);
    expect(isStreamPromptCacheEnabled(undefined)).toBe(true);
    expect(isStreamPromptCacheEnabled(true)).toBe(true);
    expect(isStreamPromptCacheEnabled(false)).toBe(false);
  });

  it('disabled 时保持 plain system string', () => {
    expect(wrapSystemForPromptCache('hello', false)).toBe('hello');
  });

  it('enabled 时 anthropic system 带 cacheControl', () => {
    const out = wrapSystemForPromptCache('stable system', {
      enabled: true,
      sdk: 'anthropic',
    });
    expect(out).toMatchObject({
      role: 'system',
      content: 'stable system',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });
  });

  it('openai 不打 anthropic cache_control', () => {
    expect(wrapSystemForPromptCache('stable system', { enabled: true, sdk: 'openai' })).toBe('stable system');
  });

  it('enabled 时在最后一个 anthropic tool 打 cache', () => {
    const tools = applyPromptCacheToTools({
      a: { description: 'a', inputSchema: { type: 'object' }, execute: async () => 'a' },
      b: { description: 'b', inputSchema: { type: 'object' }, execute: async () => 'b' },
    }, { enabled: true, sdk: 'anthropic' });
    expect(tools?.a?.providerOptions).toBeUndefined();
    expect(tools?.b?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });

  it('buildPromptCacheKey 生成稳定 key', () => {
    expect(buildPromptCacheKey({
      label: 'orchestrator',
      provider: 'anyrouter',
      modelId: 'claude-haiku-4-5',
    })).toBe('zhin:orchestrator:anyrouter:claude-haiku-4-5');
  });

  it('openai providerOptions 含 promptCacheKey', () => {
    expect(buildPromptCacheProviderOptions({
      enabled: true,
      sdk: 'openai',
      cacheKey: 'zhin:orchestrator:p:m',
      retention: '24h',
    })).toEqual({
      openai: {
        promptCacheKey: 'zhin:orchestrator:p:m',
        promptCacheRetention: '24h',
      },
    });
  });
});

import { llmToolsToAiSdk } from '../src/llm/bridge/ai-sdk-messages.js';
import type { ModelMessage } from 'ai';
import { z } from 'zod';

describe('conversation cache prefix', () => {
  it('marks the current and prior input only for enabled Anthropic requests without mutating history', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 't', toolName: 'read', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't', toolName: 'read', output: { type: 'text', value: 'result' } }] },
    ];
    const before = structuredClone(messages);
    const result = applyPromptCacheToMessages(messages, { enabled: true, sdk: 'anthropic' });
    expect(result[0]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(result[1]).toBe(messages[1]);
    expect(result[2]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(messages).toEqual(before);
    for (const sdk of ['openai', 'openai-compatible', 'google', 'minimax']) {
      expect(applyPromptCacheToMessages(messages, { enabled: true, sdk })).toBe(messages);
    }
    expect(applyPromptCacheToMessages(messages, { enabled: false, sdk: 'anthropic' })).toBe(messages);
  });

  it('anchors the breakpoint on the body, before the runtime-context tail of a user message', () => {
    const current: ModelMessage = { role: 'user', content: [
      { type: 'text', text: '[user_id:a;]\nquestion' },
      { type: 'text', text: `\n${RUNTIME_CONTEXT_MARKER}\n` },
      { type: 'text', text: '[Context source: scene]\n[scene_id:g;]\n' },
    ] };
    const messages: ModelMessage[] = [
      { role: 'user', content: '[user_id:a;]\nearlier' },
      { role: 'assistant', content: 'reply' },
      current,
    ];
    const out = applyPromptCacheToMessages(messages, { enabled: true, sdk: 'anthropic' });
    const parts = out[2]!.content as Array<{ providerOptions?: unknown }>;
    // The cached prefix ends with the body: exactly what the next request replays as history.
    expect(out[2]!.providerOptions).toBeUndefined();
    expect(parts[0]!.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(parts[1]!.providerOptions).toBeUndefined();
    expect(parts[2]!.providerOptions).toBeUndefined();
    expect(out[0]!.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    // A marker typed inside the body part itself is not a tail.
    const spoof: ModelMessage = { role: 'user', content: [{ type: 'text', text: `${RUNTIME_CONTEXT_MARKER} body` }] };
    expect(applyPromptCacheToMessages([spoof], { enabled: true, sdk: 'anthropic' })[0]!.providerOptions)
      .toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
  });

  it('preserves existing provider options and skips empty/thinking-only trailing messages', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'start', providerOptions: { other: { keep: true } } },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'signed thought' }] },
      { role: 'user', content: '' },
    ];
    const out = applyPromptCacheToMessages(messages, { enabled: true, sdk: 'anthropic' });
    expect(out[0]?.providerOptions).toMatchObject({ other: { keep: true }, anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(out[1]).toBe(messages[1]);
    expect(out[2]).toBe(messages[2]);
  });

  it('keeps tool definitions stable when the same set arrives in a different recency order', () => {
    const tools = ['z', 'a'].map(name => ({ name, description: name, parameters: z.object({ value: z.string() }) }));
    expect(Object.keys(llmToolsToAiSdk(tools)!)).toEqual(['a', 'z']);
    expect(JSON.stringify(llmToolsToAiSdk(tools))).toBe(JSON.stringify(llmToolsToAiSdk([...tools].reverse())));
    expect(tools.map(tool => tool.name)).toEqual(['z', 'a']);
  });
});


describe('Anthropic previous-request anchor', () => {
  it('keeps the input boundary before the last assistant response, not the penultimate message', () => {
    const messages: import('ai').ModelMessage[] = [
      { role: 'user', content: 'old input' },
      { role: 'assistant', content: 'previous answer' },
      ...Array.from({ length: 25 }, (_, i) => ({ role: 'user' as const, content: `new context ${i}` })),
    ];
    const before = structuredClone(messages);
    const result = applyPromptCacheToMessages(messages, { sdk: 'anthropic', enabled: true });
    const marked = result.flatMap((m, index) => m.providerOptions?.anthropic?.cacheControl ? [index] : []);
    expect(marked).toEqual([0, messages.length - 1]);
    expect(messages).toEqual(before);
    expect(result[1]).toBe(messages[1]);
  });

  it('deduplicates anchors and does not mark empty content or reasoning-only history', () => {
    const messages: import('ai').ModelMessage[] = [
      { role: 'user', content: 'old input' },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }] },
      { role: 'user', content: '' },
    ];
    const result = applyPromptCacheToMessages(messages, { sdk: 'anthropic', enabled: true });
    expect(result.filter(m => m.providerOptions?.anthropic?.cacheControl)).toHaveLength(1);
    expect(result[1]).toBe(messages[1]);
  });
});
