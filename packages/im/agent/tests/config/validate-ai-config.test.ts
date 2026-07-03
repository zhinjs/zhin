import { describe, it, expect } from 'vitest';
import { validateAiRoutingConfig } from '../../src/config/validate-ai-config.js';
import { normalizeAiRoutingConfig } from '../../src/config/normalize-ai-config.js';

describe('validateAiRoutingConfig', () => {
  it('拒绝 agents.zhin 配置 priority/match', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm', priority: 1, match: { hasMedia: ['image'] } },
      },
    } as any);
    const errors = validateAiRoutingConfig(cfg);
    expect(errors.some(e => e.includes('agents.zhin') && e.includes('priority'))).toBe(true);
  });

  it('有 match 时必须提供 priority', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm' },
        vision: { provider: 'p', model: 'm2', match: { hasMedia: ['image'] } },
      },
    } as any);
    const errors = validateAiRoutingConfig(cfg);
    expect(errors.some(e => e.includes('vision') && e.includes('priority'))).toBe(true);
  });

  it('旧版 ai.routes 归一化进 agents 后可通过校验', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm' },
        vision: { provider: 'p', model: 'm2' },
      },
      routes: { vision: { priority: 10, match: { adapter: 'icqq' } } },
    } as any);
    const errors = validateAiRoutingConfig(cfg);
    expect(errors).toEqual([]);
    expect(cfg.agents.vision?.priority).toBe(10);
    expect(cfg.agents.vision?.match?.adapter).toBe('icqq');
  });

  it('providers 缺少 sdk 时报错', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'm' } },
    } as any);
    cfg.providers.p = { apiKey: 'k' } as typeof cfg.providers.p;
    const errors = validateAiRoutingConfig(cfg);
    expect(errors.some(e => e.includes('sdk is required'))).toBe(true);
  });

  it('legacy driver 归一化为 sdk', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { deepseek: { driver: 'deepseek', apiKey: 'k' } },
      agents: { zhin: { provider: 'deepseek', model: 'm' } },
    } as any);
    expect(cfg.providers.deepseek?.sdk).toBe('deepseek');
    expect(validateAiRoutingConfig(cfg)).toEqual([]);
  });

  it('legacy ai.pipeline 迁移进 agents.<role>', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { sdk: 'openai', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'base' } },
      pipeline: {
        evaluator: { provider: 'p', model: 'glm', nickname: '分析师' },
      },
    } as any);
    expect(cfg.agents.evaluator).toEqual({
      provider: 'p',
      model: 'glm',
      nickname: '分析师',
    });
    expect(validateAiRoutingConfig(cfg)).toEqual([]);
  });

  it('拒绝 api/preset/spec 字段', () => {
    expect(() => normalizeAiRoutingConfig({
      providers: { p: { api: 'openai-completions', apiKey: 'k' } },
      agents: { zhin: { provider: 'p', model: 'm' } },
    } as any)).toThrow(/use "sdk" instead/);
  });
});
