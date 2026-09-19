/**
 * ADR 0014 P2-2 — 稳定性生命周期集成测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZhinAgent } from '../src/zhin-agent/index.js';
import { MemoryAgentSessionStore, type AIProvider } from '@zhin.js/ai';
import { wireMockLlmApi } from './helpers/mock-llm-api.js';
import { AgentCompactionRuntime } from '../src/memory/compaction-runtime.js';

import { collectStabilityMetrics, startStabilityMonitor } from '../src/stability/memory-pressure.js';
import { Adapter } from '@zhin.js/core';
import { pruneAdapterRegistry } from '../src/stability/registry-cleanup.js';

function mockProvider(): AIProvider & { dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  const provider = wireMockLlmApi().provider;
  return Object.assign(provider, { dispose }) as unknown as AIProvider & { dispose: ReturnType<typeof vi.fn> };
}

describe('stability lifecycle (ADR 0014 P2-2)', () => {
  let compactionRuntime: AgentCompactionRuntime;

  beforeEach(() => {
    compactionRuntime = new AgentCompactionRuntime();
  });

  describe('dispose-cascade', () => {
    it('ZhinAgent.dispose 后 compaction 状态清空', async () => {
      const provider = mockProvider();
      const agent = new ZhinAgent(provider);
      await agent.compactionRuntime.transformContext([], undefined, {
        host: agent as any,
        sessionId: 'session-1',
        model: { id: 'm1' } as any,
        contextWindow: 128_000,
      });
      expect(agent.compactionRuntime.stateCount).toBe(1);

      await agent.dispose();

      expect(agent.compactionRuntime.stateCount).toBe(0);
    });

    it('MemoryAgentSessionStore.dispose 清空 sessions', async () => {
      const store = new MemoryAgentSessionStore();
      await store.getOrCreateActive({
        session_key: 'k',
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
      const metrics = await collectStabilityMetrics(compactionRuntime, { includeRss: true });
      expect(metrics.compactionStates).toBeGreaterThanOrEqual(0);
      expect(typeof metrics.pendingOrchestration).toBe('number');
      expect(metrics.rssMb).toBeGreaterThan(0);
    });

    it('startStabilityMonitor 可启动并停止', () => {
      const stop = startStabilityMonitor({
        compactionRuntime,
        intervalMs: 60_000,
        collectors: [{
          name: 'compactionStates',
          collect: () => compactionRuntime.stateCount,
          threshold: 1,
        }],
      });
      expect(typeof stop).toBe('function');
      stop();
    });
  });
});
