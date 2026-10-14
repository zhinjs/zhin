import { describe, it, expect } from 'vitest';
import { applyAiConfigFixes } from '../../src/config/fix-ai-config.js';
import { DEFAULT_CONFIG, findDeprecatedAgentConfigKeys } from '../../src/config/index.js';

describe('deprecated ai.agent keys (#735)', () => {
  it('识别已弃用键并忽略其它键', () => {
    const found = findDeprecatedAgentConfigKeys({ maxSkills: 3, taskExecApprovalMode: 'auto', maxIterations: 10 });
    expect(found.map((f) => f.key).sort()).toEqual(['maxSkills', 'taskExecApprovalMode']);
    expect(findDeprecatedAgentConfigKeys(undefined)).toEqual([]);
  });

  it('--fix 迁移删除已弃用键并保留其它配置', () => {
    const { ai, fixes } = applyAiConfigFixes({
      agent: { deferredToolMaxResults: 5, policyDenialStopAfter: 2, maxIterations: 10 },
    });
    expect(ai?.agent).toEqual({ maxIterations: 10 });
    expect(fixes).toContain('removed deprecated ai.agent.deferredToolMaxResults');
    expect(fixes).toContain('removed deprecated ai.agent.policyDenialStopAfter');
  });

  it('默认配置不含已弃用键', () => {
    expect(findDeprecatedAgentConfigKeys(DEFAULT_CONFIG)).toEqual([]);
  });
});
