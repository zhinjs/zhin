import { describe, it, expect } from 'vitest';
import { iterationSceneOf, mergeModelHarnessValues, resolveModelHarness, resolveTurnMaxIterations } from '../../src/config/model-harness-runtime.js';

describe('model harness defaults', () => {
  it('应为小型 ollama 模型返回较低迭代上限', () => {
    const resolved = resolveModelHarness('ollama', 'qwen2.5:7b');
    expect(resolved.maxIterations).toBe(4);
  });

  it('未知模型应返回空默认值', () => {
    const resolved = resolveModelHarness('custom', 'my-model');
    expect(resolved.maxIterations).toBeUndefined();
  });

  it('应按 providerPatterns + models 覆盖（models 优先）', () => {
    const resolved = resolveModelHarness('openai', 'gpt-4o', {
      providerPatterns: {
        'open*': { maxIterations: 8 },
      },
      models: {
        'openai:gpt-4o': { maxIterations: 9 },
      },
    });
    expect(resolved.maxIterations).toBe(9);
  });

  it('应忽略未知 harness 键，仅保留受支持字段', () => {
    const malformedFromYaml = { maxIterations: 10, unknown: 123 };
    const resolved = resolveModelHarness('openai', 'gpt-4o', {
      models: {
        'gpt-4o': malformedFromYaml as unknown as { maxIterations?: number },
      },
    });
    expect(resolved).toEqual({ maxIterations: 10 });
    expect((resolved as any).unknown).toBeUndefined();
  });

  it('deep merge 应遵循 ADR 0006（对象合并，数组显式覆盖）', () => {
    const merged = mergeModelHarnessValues(
      {
        nested: {
          enabled: true,
          tags: ['a', 'b'],
        },
      },
      {
        nested: {
          tags: ['override'],
          extra: 'x',
        },
      },
    );
    expect(merged).toEqual({
      nested: {
        enabled: true,
        tags: ['override'],
        extra: 'x',
      },
    });
  });

  it('minimax 预设应开启一次空回复重试，且可被覆盖', () => {
    expect(resolveModelHarness('minimax', 'minimax-m3').emptyReplyRetries).toBe(1);
    const resolved = resolveModelHarness('minimax', 'minimax-m3', {
      models: { 'minimax-m3': { emptyReplyRetries: 0, requestTimeoutMs: 60_000 } },
    });
    expect(resolved).toMatchObject({ emptyReplyRetries: 0, requestTimeoutMs: 60_000 });
  });

  it('gemini 预设应开启一次空回复 / MALFORMED_FUNCTION_CALL 重问，且不影响探索预算', () => {
    for (const [provider, model] of [['gemini', 'gemini-3.8-flash'], ['openrouter', 'google/gemini-3.8-pro']] as const) {
      const resolved = resolveModelHarness(provider, model);
      expect(resolved.emptyReplyRetries).toBe(1);
      expect(resolved.explorationGuidance).toBeUndefined();
    }
    expect(resolveModelHarness('gemini', 'gemini-3.8-flash', {
      models: { 'gemini-3.8-flash': { emptyReplyRetries: 0 } },
    }).emptyReplyRetries).toBe(0);
    expect(resolveModelHarness('openai', 'gpt-5-gemini-compare').emptyReplyRetries).toBeUndefined();
  });

  it('应丢弃非法的 provider 怪癖值', () => {
    const resolved = resolveModelHarness('openai', 'gpt-4o', {
      models: { 'gpt-4o': { emptyReplyRetries: -1, requestTimeoutMs: Number.NaN } },
    });
    expect(resolved.emptyReplyRetries).toBeUndefined();
    expect(resolved.requestTimeoutMs).toBeUndefined();
  });
});

describe('scene iteration limits (ADR 0042 §7)', () => {
  const base = { providerName: 'custom', modelName: 'my-model', configured: 15 } as const;

  it('defaults to 6 / 10 / 15 for group / private / master private', () => {
    expect(resolveTurnMaxIterations({ ...base, scene: 'group' })).toBe(6);
    expect(resolveTurnMaxIterations({ ...base, scene: 'private' })).toBe(10);
    expect(resolveTurnMaxIterations({ ...base, scene: 'master-private' })).toBe(15);
    expect(resolveTurnMaxIterations({ ...base })).toBe(15);
  });

  it('classifies turns by origin scope and master role', () => {
    const turn = (scope: string, roles: string[], kind = 'im') => ({ origin: { kind, scope }, principal: { roles } });
    expect(iterationSceneOf(turn('group', ['master']))).toBe('group');
    expect(iterationSceneOf(turn('private', ['user']))).toBe('private');
    expect(iterationSceneOf(turn('private', ['master']))).toBe('master-private');
    expect(iterationSceneOf(turn('private', ['master'], 'http'))).toBeUndefined();
  });

  it('modelHarness overrides win, then a customised ai.agent.maxIterations', () => {
    expect(resolveTurnMaxIterations({ ...base, scene: 'group', modelHarness: { models: { 'my-model': { maxIterations: 12 } } } })).toBe(12);
    expect(resolveTurnMaxIterations({ ...base, scene: 'group', configured: 20 })).toBe(20);
  });

  it('never raises a built-in per-model limit', () => {
    expect(resolveTurnMaxIterations({ providerName: 'openai', modelName: 'gpt-4o', configured: 15, scene: 'group' })).toBe(6);
    expect(resolveTurnMaxIterations({ providerName: 'openai', modelName: 'gpt-4o', configured: 15, scene: 'master-private' })).toBe(7);
    expect(resolveTurnMaxIterations({ providerName: 'ollama', modelName: 'qwen2.5:7b', configured: 15, scene: 'private' })).toBe(4);
  });
});
