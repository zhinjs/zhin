import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAgentPersistence } from '../../../src/plugin-runtime/host/persistence-coordinator.js';

type Install = Parameters<typeof installAgentPersistence>;

describe('installAgentPersistence — usage quota retention', () => {
  afterEach(() => vi.useRealTimers());

  it('prunes in-memory quota buckets from the hourly housekeeping timer', async () => {
    vi.useFakeTimers();
    const prune = vi.fn();
    const cleanups: Array<() => unknown> = [];
    const handoffs: Array<{ activateNext(signal: AbortSignal): Promise<void> }> = [];
    const context = {
      resources: { has: () => false, use: () => undefined, provide: () => undefined },
      lifecycle: { add: (cleanup: () => unknown) => { cleanups.push(cleanup); } },
      handoff: { add: (entry: { activateNext(signal: AbortSignal): Promise<void> }) => { handoffs.push(entry); } },
      admission: { onActivate: (run: () => void) => { run(); return () => {}; } },
    } as unknown as Install[0];
    const foundation = {
      semanticMemory: null,
      agent: { markMemoryPersistenceReady: () => {}, usageQuota: { prune } },
      schedule: { start: async () => {}, history: { housekeeping: () => {} } },
    } as unknown as Install[1];

    installAgentPersistence(context, foundation, { sessions: { useDatabase: false } } as Install[2]);
    await handoffs[0]!.activateNext(new AbortController().signal);
    expect(prune).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(prune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(prune).toHaveBeenCalledTimes(2);

    for (const cleanup of cleanups) await cleanup();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(prune).toHaveBeenCalledTimes(2);
  });
});
