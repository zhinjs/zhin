import { describe, it, expect } from 'vitest';
import { resolveModelHarness } from '../../src/zhin-agent/model-harness.js';

describe('model harness defaults', () => {
  it('应为小型 ollama 模型返回较低迭代上限', () => {
    const resolved = resolveModelHarness('ollama', 'qwen2.5:7b');
    expect(resolved.maxIterations).toBe(4);
  });

  it('未知模型应返回空默认值', () => {
    const resolved = resolveModelHarness('custom', 'my-model');
    expect(resolved.maxIterations).toBeUndefined();
  });
});
