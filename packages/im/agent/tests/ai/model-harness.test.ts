import { describe, it, expect } from 'vitest';
import { mergeModelHarnessValues, resolveModelHarness } from '../../src/config/model-harness-runtime.js';

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
});
