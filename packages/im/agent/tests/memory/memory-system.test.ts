import { describe, expect, it, vi } from 'vitest';
import * as ai from '@zhin.js/ai';
import { AiCompactionStrategy } from '../../src/memory/ai-compaction-strategy.js';
import { createMemorySystemForHost } from '../../src/memory/memory-system.js';
import { getCompactionStateCount, clearCompactionStates } from '../../src/memory/compaction-runtime.js';
import { defaultMemorySystem } from '../../src/memory/memory-system.js';

describe('MemorySystem', () => {
  it('compaction runtime tracks in-memory state count', () => {
    clearCompactionStates();
    expect(getCompactionStateCount()).toBe(0);
  });

  it('defaultMemorySystem exposes compactSessionForCommMessage', () => {
    expect(typeof defaultMemorySystem.compactSessionForCommMessage).toBe('function');
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
