/**
 * ADR 0014 P2-2 — 稳定性生命周期集成测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZhinAgent } from '../src/zhin-agent/index.js';
import type { AIProvider } from '@zhin.js/ai';
import {
  getCompactionStateCount,
  clearCompactionStates,
} from '../src/zhin-agent/compaction-runtime.js';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import { MemoryAgentSessionStore } from '@zhin.js/ai';
import { collectStabilityMetrics, startStabilityMonitor } from '../src/stability/memory-pressure.js';
import { Adapter } from '@zhin.js/core';
import { pruneAdapterRegistry } from '../src/stability/registry-cleanup.js';
import { BaseProvider } from '@zhin.js/ai';

function mockProvider(): AIProvider & { dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  return {
    name: 'mock',
    models: ['m'],
    chat: vi.fn(async () => ({
      choices: [{ message: { role: 'assistant' as const, content: 'ok' }, finish_reason: 'stop' }],
    })),
    chatStream: vi.fn(async function* () {}),
    dispose,
  };
}

describe('stability lifecycle (ADR 0014 P2-2)', () => {
  beforeEach(() => {
    clearCompactionStates();
  });

  describe('dispose-cascade', () => {
    it('ZhinAgent.dispose 后 compaction 状态清空', () => {
      clearCompactionStates();
      expect(getCompactionStateCount()).toBe(0);
      const provider = mockProvider();
      const agent = new ZhinAgent(provider);
      clearCompactionStates();
      expect(getCompactionStateCount()).toBe(0);

      agent.dispose();

      expect(getCompactionStateCount()).toBe(0);
    });

    it('MemoryOrchestrationRepository.dispose 清空 runs/tasks', async () => {
      const repo = new MemoryOrchestrationRepository();
      const run = await repo.createRun({ session_key: 'k1' });
      await repo.createTask({
        run_id: run.id,
        name: 't1',
        description: 'task',
      });
      expect(repo.runCount()).toBeGreaterThan(0);
      expect(repo.taskCount()).toBeGreaterThan(0);

      repo.dispose();

      expect(repo.runCount()).toBe(0);
      expect(repo.taskCount()).toBe(0);
    });

    it('MemoryAgentSessionStore.dispose 清空 sessions', async () => {
      const store = new MemoryAgentSessionStore();
      await store.getOrCreateActive({
        session_key: 'k',
        platform: 'p',
        bot_id: 'b',
        scene_id: 's',
        scene_type: 'private',
      });
      expect(store.sessionCount).toBe(1);
      store.dispose();
      expect(store.sessionCount).toBe(0);
    });
  });

  describe('registry hot-reload', () => {
    afterEach(() => {
      Adapter.Registry.delete('test-adapter-stability');
    });

    it('pruneAdapterRegistry 保留指定名称', () => {
      Adapter.register('test-adapter-stability', () => ({}) as never);
      const keepSize = Adapter.Registry.size;
      Adapter.register('to-prune', () => ({}) as never);
      expect(Adapter.Registry.size).toBe(keepSize + 1);

      pruneAdapterRegistry([...Adapter.Registry.keys()].filter((n) => n !== 'to-prune'));

      expect(Adapter.Registry.has('to-prune')).toBe(false);
      expect(Adapter.Registry.has('test-adapter-stability')).toBe(true);
      Adapter.Registry.delete('to-prune');
    });
  });

  describe('memory-pressure', () => {
    it('collectStabilityMetrics 返回关键计数', async () => {
      clearCompactionStates();
      const metrics = await collectStabilityMetrics({ includeSse: false, includeRss: true });
      expect(metrics.compactionStates).toBeGreaterThanOrEqual(0);
      expect(typeof metrics.pendingOrchestration).toBe('number');
      expect(metrics.rssMb).toBeGreaterThan(0);
    });

    it('startStabilityMonitor 可启动并停止', () => {
      const stop = startStabilityMonitor({
        intervalMs: 60_000,
        collectors: [{
          name: 'compactionStates',
          collect: getCompactionStateCount,
          threshold: 1,
        }],
      });
      expect(typeof stop).toBe('function');
      stop();
    });
  });

  describe('BaseProvider dispose', () => {
    class TestProvider extends BaseProvider {
      name = 'test';
      models = ['m'];
      async chat() {
        return {
          id: '1',
          object: 'chat.completion',
          created: Date.now(),
          model: 'm',
          choices: [],
        };
      }
      async *chatStream() {
        yield* [];
      }
    }

    it('dispose 后 abortControllers 为空', () => {
      const p = new TestProvider();
      expect(p.abortControllers.size).toBe(0);
      p.dispose();
      expect(p.abortControllers.size).toBe(0);
    });
  });
});
