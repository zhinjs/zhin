import { describe, expect, it, vi } from 'vitest';
import * as ai from '@zhin.js/ai';
import { AiCompactionStrategy } from '../../src/memory/ai-compaction-strategy.js';
import { createMemorySystemForHost, defaultMemorySystem } from '../../src/memory/memory-system.js';
import { AgentCompactionRuntime } from '../../src/memory/compaction-runtime.js';

describe('MemorySystem', () => {
  it('compaction runtimes own isolated state', async () => {
    const first = new AgentCompactionRuntime();
    const second = new AgentCompactionRuntime();
    const host = {
      contextRepository: {
        resolveCompactionAnchorId: vi.fn(),
        saveSummary: vi.fn(),
      },
    } as any;
    const options = {
      host,
      sessionId: 'shared-session',
      model: { id: 'm1' } as any,
      contextWindow: 128_000,
    };

    await first.transformContext([], undefined, options);

    expect(first.stateCount).toBe(1);
    expect(second.stateCount).toBe(0);
    first.clear();
    expect(first.stateCount).toBe(0);
  });

  it('evicts least-recently-used states within one runtime', async () => {
    const runtime = new AgentCompactionRuntime(5);
    const host = {
      contextRepository: {
        resolveCompactionAnchorId: vi.fn(),
        saveSummary: vi.fn(),
      },
    } as any;
    for (let index = 0; index < 5; index += 1) {
      await runtime.transformContext([], undefined, {
        host,
        sessionId: `session-${index}`,
        model: { id: 'm1' } as any,
        contextWindow: 128_000,
      });
    }
    runtime.touch('session-0');

    expect(runtime.evictIfOverPressure()).toBe(2);
    expect(runtime.stateCount).toBe(3);
  });

  it('defaultMemorySystem exposes canonical session-key compaction', () => {
    expect(typeof defaultMemorySystem.compactSession).toBe('function');
  });

  it('createMemorySystemForHost uses AiCompactionStrategy', () => {
    vi.spyOn(ai, 'getLlmTransportModel').mockReturnValue({
      id: 'm1',
      contextWindow: 128_000,
    } as any);
    const host = {
      getTurnProvider: () => ({ name: 'mock', models: ['m1'] }),
      config: {
        chatModel: 'm1',
        contextTokens: 128_000,
        compaction: { enabled: true, auto: true, keepRecentTokens: 20_000, minKeepCount: 2 },
      },
      contextRepository: {} as any,
    } as any;
    const system = createMemorySystemForHost(host);
    const strategy = (system as any)._config.compactionStrategy;
    expect(strategy).toBeInstanceOf(AiCompactionStrategy);
  });
});
