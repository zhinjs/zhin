import type { FixtureTextProvider } from '../../ai/tests/helpers/text-provider-fixture.js';
/**
 * ADR 0014 P2-2 — 稳定性生命周期集成测试
 */
import { describe, it, expect, vi } from 'vitest';
import { ZhinAgent } from '../src/zhin-agent/index.js';
import {MemoryAgentSessionStore} from '@zhin.js/ai';
import { wireMockLlmApi } from './helpers/mock-llm-api.js';

function mockProvider(): FixtureTextProvider & { dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  const provider = wireMockLlmApi().provider;
  return Object.assign(provider, { dispose }) as unknown as FixtureTextProvider & { dispose: ReturnType<typeof vi.fn> };
}

describe('stability lifecycle (ADR 0014 P2-2)', () => {
  describe('dispose-cascade', () => {
    it('ZhinAgent.dispose 后 compaction 状态清空', async () => {
      const provider = mockProvider();
      const agent = new ZhinAgent();
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

    it('archiveSession 清空该会话的已告知与投递记录（#1250，ADR 0067 D7）', async () => {
      const agent = new ZhinAgent();
      const active = await agent.agentSessionStore.getOrCreateActive({ session_key: 'key-1' });
      const ref = 'delivered-message:x';
      for (const id of [active.session_id, 'other-session']) {
        agent.toldLedger.record(id, '好的，已经记下了。', 'reply', 'turn-1');
        agent.toldLedger.recordDelivered(id, [ref]);
      }

      await agent.archiveSession('key-1');

      expect(agent.toldLedger.hasDelivered(active.session_id, ref)).toBe(false);
      expect(agent.toldLedger.entries(active.session_id)).toEqual([]);
      // Other sessions keep theirs.
      expect(agent.toldLedger.hasDelivered('other-session', ref)).toBe(true);
      await agent.dispose();
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
});
