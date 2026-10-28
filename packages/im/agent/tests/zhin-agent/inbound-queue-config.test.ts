import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INBOUND_MERGE_CONFIG,
  DEFAULT_INBOUND_QUEUE_CONFIG,
  normalizeInboundQueueConfig,
  shouldUseGroupFifoQueue,
  validateInboundQueueConfig,
} from '../../src/turn/inbound-queue-config.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('inbound-queue-config', () => {
  it('defaults to supersede for compatibility', () => {
    expect(normalizeInboundQueueConfig()).toEqual(DEFAULT_INBOUND_QUEUE_CONFIG);
  });

  it('normalizes fifo mode and timing fields', () => {
    expect(normalizeInboundQueueConfig({
      groupMode: 'fifo',
      ttlMs: 60_000,
      coalesceWindowMs: 10_000,
    })).toEqual({
      groupMode: 'fifo',
      ttlMs: 60_000,
      coalesceWindowMs: 10_000,
      maxQueuedTurns: 5,
      merge: DEFAULT_INBOUND_MERGE_CONFIG,
    });
  });

  it('keeps the ADR 0038 merge window off by default and normalizes its timings', () => {
    expect(normalizeInboundQueueConfig().merge).toEqual({ enabled: false, quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 5 });
    expect(normalizeInboundQueueConfig({ merge: { enabled: true, quietMs: 3_000, maxWaitMs: 1_000, maxSenders: 0 } }).merge)
      .toEqual({ enabled: true, quietMs: 3_000, maxWaitMs: 3_000, maxSenders: 5 });
  });

  it('validates merge window fields', () => {
    expect(validateInboundQueueConfig({
      merge: { enabled: 'yes' as unknown as boolean, quietMs: -1, maxWaitMs: Number.NaN, maxSenders: 1.5 },
    })).toEqual([
      'ai.agent.inboundQueue.merge.enabled must be a boolean',
      'ai.agent.inboundQueue.merge.quietMs must be a non-negative number',
      'ai.agent.inboundQueue.merge.maxWaitMs must be a non-negative number',
      'ai.agent.inboundQueue.merge.maxSenders must be a positive integer',
    ]);
  });

  it('validates invalid config', () => {
    expect(validateInboundQueueConfig({ groupMode: 'parallel' as 'fifo' })).toEqual([
      'ai.agent.inboundQueue.groupMode must be supersede or fifo',
    ]);
  });

  it('enables fifo only for group/channel scenes', () => {
    const fifo = normalizeInboundQueueConfig({ groupMode: 'fifo' });
    const groupMsg = mockCommMessage({ scope: 'group', sceneId: 'g1', senderId: 'u1' });
    const privateMsg = mockCommMessage({ scope: 'private', senderId: 'u1' });
    expect(shouldUseGroupFifoQueue(groupMsg, fifo)).toBe(true);
    expect(shouldUseGroupFifoQueue(privateMsg, fifo)).toBe(false);
  });
});
