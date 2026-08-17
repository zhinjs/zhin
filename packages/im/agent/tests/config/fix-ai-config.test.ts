import { describe, it, expect } from 'vitest';
import { applyAiConfigFixes } from '../../src/config/fix-ai-config.js';
import { validateAiRoutingConfig, normalizeAiRoutingConfig } from '../../src/config/index.js';

describe('applyAiConfigFixes', () => {
  it('应迁移 defaultProvider、routes 与 driver 供 setup 一次性升级', () => {
    const { ai, fixes } = applyAiConfigFixes({
      defaultProvider: 'openai',
      agent: { chatModel: 'gpt-4o-mini' },
      routes: {
        vision: { priority: 10, match: { hasMedia: ['image'] } },
      },
      providers: {
        openai: { driver: 'openai', apiKey: 'x' },
      },
      agents: {
        vision: { provider: 'openai', model: 'gpt-4o', priority: 10, match: { hasMedia: ['image'] } },
        zhin: { provider: 'openai', model: 'gpt-4o-mini' },
      },
    });

    expect(fixes.length).toBeGreaterThan(0);
    const normalized = normalizeAiRoutingConfig(ai as never);
    expect(validateAiRoutingConfig(normalized)).toEqual([]);
    expect(normalized.agents.zhin?.model).toBe('gpt-4o-mini');
    expect(normalized.agents.vision?.priority).toBe(10);
  });

});

describe('normalizeAiRoutingConfig breaking rejects', () => {
  it('拒绝未迁移的 ai.routes', () => {
    expect(() => normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'm' } },
      routes: { vision: { priority: 10, match: { adapter: 'icqq' } } },
    } as never)).toThrow(/ai\.routes removed/);
  });

  it('拒绝未迁移的 ai.pipeline', () => {
    expect(() => normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'base' } },
      pipeline: { evaluator: { provider: 'p', model: 'glm' } },
    } as never)).toThrow(/ai\.pipeline removed/);
  });
});

describe('normalizeAiRoutingConfig provider gateway presets', () => {
  it('coerces test-bot style OpenCode provider to openai-compatible', () => {
    const normalized = normalizeAiRoutingConfig({
      providers: {
        opencode: {
          sdk: 'openai',
          baseUrl: 'https://opencode.ai/zen/v1',
          apiKey: 'k',
          models: ['mimo-v2.5-free'],
        },
      },
      agents: { zhin: { provider: 'opencode', model: 'mimo-v2.5-free' } },
    } as never);
    expect(normalized.providers.opencode?.sdk).toBe('openai-compatible');
    expect(normalized.providers.opencode?.contextWindow).toBe(32_768);
  });

  it('infers OpenCode sdk from alias when yaml omits sdk', () => {
    const normalized = normalizeAiRoutingConfig({
      providers: {
        opencode: {
          baseUrl: 'https://opencode.ai/zen/v1',
          apiKey: 'k',
        },
      },
      agents: { zhin: { provider: 'opencode', model: 'mimo-v2.5-free' } },
    } as never);
    expect(normalized.providers.opencode?.sdk).toBe('openai-compatible');
  });
});
