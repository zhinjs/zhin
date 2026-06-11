import { describe, it, expect } from 'vitest';
import { applyAiConfigFixes } from '../../src/config/fix-ai-config.js';
import { validateAiRoutingConfig, normalizeAiRoutingConfig } from '../../src/config/index.js';

describe('applyAiConfigFixes', () => {
  it('应迁移 defaultProvider、routes 与 driver', () => {
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
        vision: { provider: 'openai', model: 'gpt-4o' },
      },
    });

    expect(fixes.length).toBeGreaterThan(0);
    const normalized = normalizeAiRoutingConfig(ai as never);
    expect(validateAiRoutingConfig(normalized)).toEqual([]);
    expect(normalized.agents.zhin?.model).toBe('gpt-4o-mini');
    expect(normalized.agents.vision?.priority).toBe(10);
  });
});
