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

  it('应迁移 ai.pipeline 并删除顶层 pipeline', () => {
    const { ai, fixes } = applyAiConfigFixes({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'base' },
        evaluator: { provider: 'p', model: 'glm', nickname: '分析师' },
      },
      pipeline: { evaluator: { provider: 'p', model: 'glm', nickname: '分析师' } },
    });

    expect(fixes).toContain('merged ai.pipeline into ai.agents and removed ai.pipeline');
    expect(ai?.pipeline).toBeUndefined();
    const normalized = normalizeAiRoutingConfig(ai as never);
    expect(normalized.agents.evaluator?.model).toBe('glm');
    expect(validateAiRoutingConfig(normalized)).toEqual([]);
  });

  it('pipeline 迁移在仅有 defaultProvider 时仍应合成 zhin 并保留角色映射', () => {
    const { ai, fixes } = applyAiConfigFixes({
      defaultProvider: 'p',
      agent: { chatModel: 'base-model' },
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      pipeline: {
        planner: { provider: 'p', model: 'planner-model' },
        researcher: { provider: 'p', model: 'researcher-model' },
      },
    });

    expect(fixes).toContain('migrated ai.defaultProvider into ai.agents.zhin');
    expect(fixes).toContain('merged ai.pipeline into ai.agents and removed ai.pipeline');
    const normalized = normalizeAiRoutingConfig(ai as never);
    expect(normalized.agents.zhin?.provider).toBe('p');
    expect(normalized.agents.zhin?.model).toBe('base-model');
    expect(normalized.agents.planner?.model).toBe('planner-model');
    expect(normalized.agents.researcher?.model).toBe('researcher-model');
    expect(validateAiRoutingConfig(normalized)).toEqual([]);
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
