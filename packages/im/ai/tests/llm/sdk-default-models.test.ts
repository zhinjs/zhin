import { describe, it, expect } from 'vitest';
import {
  resolveSdkProviderModels,
  SDK_DEFAULT_MODELS,
  ANYROUTER_ANTHROPIC_MODELS,
} from '../../src/llm/sdk-default-models.js';

describe('sdk-default-models', () => {
  it('uses yaml models when provided', () => {
    const models = resolveSdkProviderModels('anthropic', {
      models: ['custom-claude'],
    });
    expect(models).toEqual(['custom-claude']);
  });

  it('falls back to anthropic preset when models omitted', () => {
    const models = resolveSdkProviderModels('anthropic', {});
    expect(models).toEqual([...SDK_DEFAULT_MODELS.anthropic]);
  });

  it('prepends defaultModel when not in list', () => {
    const models = resolveSdkProviderModels('anthropic', {
      models: ['claude-sonnet-4-6'],
      defaultModel: 'claude-haiku-4-5-20251001',
    });
    expect(models[0]).toBe('claude-haiku-4-5-20251001');
    expect(models).toContain('claude-sonnet-4-6');
  });

  it('openai-compatible has empty preset (discovery path)', () => {
    expect(resolveSdkProviderModels('openai-compatible', {})).toEqual([]);
    expect(SDK_DEFAULT_MODELS['openai-compatible']).toEqual([]);
  });

  it('exports AnyRouter Claude Code relay preset ids', () => {
    expect(ANYROUTER_ANTHROPIC_MODELS.length).toBeGreaterThan(0);
    expect(ANYROUTER_ANTHROPIC_MODELS[0]).toMatch(/^claude-/);
  });
});
