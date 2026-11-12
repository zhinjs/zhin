import { describe, it, expect } from 'vitest';
import { iterationSceneOf, mergeModelHarnessValues, resolveModelHarness, resolveTurnMaxIterations } from '../../src/config/model-harness-runtime.js';
describe('model harness defaults', () => {
    it('应为小型 ollama 模型返回较低迭代上限', () => {
        const resolved = resolveModelHarness({ driver: { id: 'ollama', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'qwen2.5:7b' });
        expect(resolved.maxIterations).toBe(4);
    });
    it('未知模型应返回空默认值', () => {
        const resolved = resolveModelHarness({ driver: { id: 'custom', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'my-model' });
        expect(resolved.maxIterations).toBeUndefined();
    });
    it('Service 默认值与精确模型覆盖保持原合并优先级', () => {
        const resolved = resolveModelHarness({ driver: { id: 'openai', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'gpt-4o', config: { services: { "test-service": { defaults: { maxIterations: 8 }, models: {
                            "gpt-4o": { maxIterations: 9 }
                        } } } } });
        expect(resolved.maxIterations).toBe(9);
    });
    it('应忽略未知 harness 键，仅保留受支持字段', () => {
        const malformedFromYaml = { maxIterations: 10, unknown: 123 };
        const resolved = resolveModelHarness({ driver: { id: 'openai', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'gpt-4o', config: { services: { "test-service": { models: {
                            "gpt-4o": malformedFromYaml as unknown as {
                                maxIterations?: number;
                            }
                        } } } } });
        expect(resolved).toEqual({ maxIterations: 10 });
        expect((resolved as any).unknown).toBeUndefined();
    });
    it('deep merge 应遵循 ADR 0006（对象合并，数组显式覆盖）', () => {
        const merged = mergeModelHarnessValues({
            nested: {
                enabled: true,
                tags: ['a', 'b'],
            },
        }, {
            nested: {
                tags: ['override'],
                extra: 'x',
            },
        });
        expect(merged).toEqual({
            nested: {
                enabled: true,
                tags: ['override'],
                extra: 'x',
            },
        });
    });
    it('minimax 预设应开启一次空回复重试，且可被覆盖', () => {
        expect(resolveModelHarness({ driver: { id: 'minimax', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'minimax-m3' }).emptyReplyRetries).toBe(1);
        const resolved = resolveModelHarness({ driver: { id: 'minimax', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'minimax-m3', config: { services: { "test-service": { models: { "minimax-m3": { emptyReplyRetries: 0, requestTimeoutMs: 60000 } } } } } });
        expect(resolved).toMatchObject({ emptyReplyRetries: 0, requestTimeoutMs: 60000 });
    });
    it('gemini 预设应开启一次空回复 / MALFORMED_FUNCTION_CALL 重问，且不影响探索预算', () => {
        for (const [provider, model] of [['google', 'gemini-3.8-flash'], ['antigravity', 'gemini-3.8-flash'], ['openai-compatible', 'gemini-3.8-flash'], ['openai-compatible', 'google/gemini-3.8-pro']] as const) {
            const resolved = resolveModelHarness({ driver: { id: provider, owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: model });
            expect(resolved.emptyReplyRetries).toBe(1);
            expect(resolved.explorationGuidance).toBeUndefined();
        }
        expect(resolveModelHarness({ driver: { id: 'google', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'gemini-3.8-flash', config: { services: { "test-service": { models: { "gemini-3.8-flash": { emptyReplyRetries: 0 } } } } } }).emptyReplyRetries).toBe(0);
        expect(resolveModelHarness({ driver: { id: 'openai', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'gpt-5-gemini-compare' }).emptyReplyRetries).toBeUndefined();
    });
    it('应丢弃非法的 provider 怪癖值', () => {
        const resolved = resolveModelHarness({ driver: { id: 'openai', owner: "root", contractVersion: "1" }, serviceId: "test-service", modelId: 'gpt-4o', config: { services: { "test-service": { models: { "gpt-4o": { emptyReplyRetries: -1, requestTimeoutMs: Number.NaN } } } } } });
        expect(resolved.emptyReplyRetries).toBeUndefined();
        expect(resolved.requestTimeoutMs).toBeUndefined();
    });
});
describe('scene iteration limits (ADR 0042 §7)', () => {
    const base = { driver: { id: 'custom', owner: "root", contractVersion: "1" }, modelId: 'my-model', configured: 15, serviceId: "test-service" } as const;
    it('defaults to 6 / 10 / 15 for group / private / master private', () => {
        expect(resolveTurnMaxIterations({ ...base, scene: 'group' })).toBe(6);
        expect(resolveTurnMaxIterations({ ...base, scene: 'private' })).toBe(10);
        expect(resolveTurnMaxIterations({ ...base, scene: 'master-private' })).toBe(15);
        expect(resolveTurnMaxIterations({ ...base })).toBe(15);
    });
    it('classifies turns by origin scope and master role', () => {
        const turn = (scope: string, roles: string[], kind = 'im') => ({ origin: { kind, scope }, principal: { roles } });
        expect(iterationSceneOf(turn('group', ['owner']))).toBe('group');
        expect(iterationSceneOf(turn('private', ['user']))).toBe('private');
        expect(iterationSceneOf(turn('private', ['owner']))).toBe('master-private');
        expect(iterationSceneOf(turn('private', ['owner'], 'http'))).toBeUndefined();
    });
    it('modelHarness overrides win, then a customised ai.agent.maxIterations', () => {
        expect(resolveTurnMaxIterations({ ...base, scene: 'group', modelHarness: { services: { "test-service": { models: { "my-model": { maxIterations: 12 } } } } } })).toBe(12);
        expect(resolveTurnMaxIterations({ ...base, scene: 'group', configured: 20 })).toBe(20);
    });
    it('never raises a built-in per-model limit', () => {
        expect(resolveTurnMaxIterations({ driver: { id: 'openai', owner: "root", contractVersion: "1" }, modelId: 'gpt-4o', configured: 15, scene: 'group', serviceId: "test-service" })).toBe(6);
        expect(resolveTurnMaxIterations({ driver: { id: 'openai', owner: "root", contractVersion: "1" }, modelId: 'gpt-4o', configured: 15, scene: 'master-private', serviceId: "test-service" })).toBe(7);
        expect(resolveTurnMaxIterations({ driver: { id: 'ollama', owner: "root", contractVersion: "1" }, modelId: 'qwen2.5:7b', configured: 15, scene: 'private', serviceId: "test-service" })).toBe(4);
    });
});


it('does not apply an official Driver default to a different owner or contract with the same id', () => {
  expect(resolveModelHarness({ driver: { id: 'ollama', owner: 'root/third-party', contractVersion: '1' }, serviceId: 'service', modelId: 'qwen2.5:7b' })).toEqual({});
  expect(resolveModelHarness({ driver: { id: 'ollama', owner: 'root', contractVersion: '2' }, serviceId: 'service', modelId: 'qwen2.5:7b' })).toEqual({});
  expect(resolveModelHarness({ driver: { id: 'ollama', owner: 'root', contractVersion: '1' }, serviceId: 'other-service', modelId: 'qwen2.5:7b', config: { services: { service: { defaults: { maxIterations: 20 } } } } }).maxIterations).toBe(4);
});

it('requires exact official Driver identity for MiniMax and Gemini quirks', () => {
  for (const modelId of ['gemini-3.8-flash', 'google/gemini-3.8-pro', 'minimax-m3', 'minimax/minimax-m3']) {
    for (const driver of [
      { id: 'custom', owner: 'root', contractVersion: '1' },
      { id: 'google', owner: 'root/other', contractVersion: '1' },
      { id: 'openai-compatible', owner: 'root/other', contractVersion: '1' },
      { id: 'openai-compatible', owner: 'root', contractVersion: '2' },
    ]) expect(resolveModelHarness({ driver, serviceId: 'service', modelId })).toEqual({});
  }
  for (const modelId of ['minimax-m3', 'minimax/minimax-m3']) {
    expect(resolveModelHarness({ driver: { id: 'openai-compatible', owner: 'root', contractVersion: '1' }, serviceId: 'service', modelId }))
      .toEqual({ explorationBudget: 5, explorationGuidance: true, emptyReplyRetries: 1 });
  }
});
