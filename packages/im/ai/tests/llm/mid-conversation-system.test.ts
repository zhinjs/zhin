import { describe, expect, it } from 'vitest';
import { resolveMidConversationSystem } from '../../src/index.js';

describe('midConversationSystem capability defaults', () => {
  it('OpenAI: system, reasoning models developer', () => {
    expect(resolveMidConversationSystem({ sdk: 'openai', id: 'gpt-4o' })).toBe('system');
    expect(resolveMidConversationSystem({ sdk: 'openai', id: 'o3-mini' })).toBe('developer');
    expect(resolveMidConversationSystem({ sdk: 'openai', id: 'gpt-5' })).toBe('developer');
    expect(resolveMidConversationSystem({ sdk: 'openai', id: 'o3', compat: { supportsDeveloperRole: false } })).toBe('system');
  });

  it('remote OpenAI-compatible: system', () => {
    expect(resolveMidConversationSystem({ sdk: 'openai-compatible', id: 'x', baseUrl: 'https://api.groq.com/openai/v1' })).toBe('system');
  });

  it('DeepSeek: none (downgraded to user) unless configured', () => {
    expect(resolveMidConversationSystem({ sdk: 'deepseek', id: 'deepseek-chat' })).toBe('none');
    expect(resolveMidConversationSystem({ sdk: 'deepseek', id: 'deepseek-chat', compat: { midConversationSystem: 'system' } })).toBe('system');
  });

  it('local servers: none unless configured', () => {
    for (const baseUrl of ['http://localhost:8000/v1', 'http://127.0.0.1:11434', 'http://192.168.1.5:8000/v1', 'http://gpu.local/v1']) {
      expect(resolveMidConversationSystem({ sdk: 'openai-compatible', id: 'qwen', baseUrl })).toBe('none');
    }
    expect(resolveMidConversationSystem({ sdk: 'ollama', id: 'llama3' })).toBe('none');
    expect(resolveMidConversationSystem({ sdk: 'openai-compatible', id: 'qwen', baseUrl: 'http://localhost:8000/v1', compat: { midConversationSystem: 'system' } })).toBe('system');
  });

  it('Anthropic, Gemini, MiniMax and unknown: none', () => {
    for (const sdk of ['anthropic', 'google', 'minimax', undefined] as const) {
      expect(resolveMidConversationSystem({ sdk, id: 'm' })).toBe('none');
    }
    expect(resolveMidConversationSystem({ sdk: 'anthropic', id: 'm', compat: { midConversationSystem: 'system' } })).toBe('system');
  });
});
