import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INBOUND_QUEUE_CONFIG,
  normalizeInboundQueueConfig,
  shouldUseGroupFifoQueue,
  validateInboundQueueConfig,
} from '../../src/zhin-agent/inbound-queue-config.js';
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
    });
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
