import { describe, it, expect } from 'vitest';
import {
  applyPromptCacheToTools,
  buildPromptCacheKey,
  buildPromptCacheProviderOptions,
  isStreamPromptCacheEnabled,
  wrapSystemForPromptCache,
} from '../src/llm/bridge/ai-sdk-prompt-cache.js';

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

import { applyPromptCacheToMessages } from '../src/llm/bridge/ai-sdk-prompt-cache.js';
import { llmToolsToAiSdk } from '../src/llm/bridge/ai-sdk-messages.js';
import type { ModelMessage } from 'ai';
import { z } from 'zod';

describe('conversation cache prefix', () => {
  it('marks the last cacheable message only for enabled Anthropic requests without mutating history', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 't', toolName: 'read', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't', toolName: 'read', output: { type: 'text', value: 'result' } }] },
    ];
    const before = structuredClone(messages);
    const result = applyPromptCacheToMessages(messages, { enabled: true, sdk: 'anthropic' });
    expect(result.slice(0, -1)).toEqual(before.slice(0, -1));
    expect(result[2]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(messages).toEqual(before);
    for (const sdk of ['openai', 'openai-compatible', 'google', 'minimax']) {
      expect(applyPromptCacheToMessages(messages, { enabled: true, sdk })).toBe(messages);
    }
    expect(applyPromptCacheToMessages(messages, { enabled: false, sdk: 'anthropic' })).toBe(messages);
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
