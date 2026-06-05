import { describe, it, expect } from 'vitest';
import { validateAiRoutingConfig } from '../../src/config/validate-ai-config.js';
import { normalizeAiRoutingConfig } from '../../src/config/normalize-ai-config.js';

describe('validateAiRoutingConfig', () => {
  it('拒绝 agents.zhin 配置 priority/match', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { driver: 'openai', apiKey: 'k' } },
      agents: {
        zhin: { provider: 'p', model: 'm', priority: 1, match: { hasMedia: ['image'] } },
      },
    } as any);
    const errors = validateAiRoutingConfig(cfg);
    expect(errors.some(e => e.includes('agents.zhin') && e.includes('priority'))).toBe(true);
  });

  it('有 match 时必须提供 priority', () => {
    const cfg = normalizeAiRoutingConfig({
      providers: { p: { driver: 'openai', apiKey: 'k' } },
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
      providers: { p: { driver: 'openai', apiKey: 'k' } },
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
});
