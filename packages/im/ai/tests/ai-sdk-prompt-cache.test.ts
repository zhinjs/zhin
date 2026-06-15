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
