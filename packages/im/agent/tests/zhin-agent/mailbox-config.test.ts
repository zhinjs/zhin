import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAILBOX_LIVE_CONFIG,
  DEFAULT_MAILBOX_MERGE_CONFIG,
  DEFAULT_MAILBOX_CONFIG,
  MAILBOX_MIGRATION_HINT,
  normalizeMailboxConfig,
  validateMailboxConfig,
} from '../../src/turn/mailbox-config.js';
import { validateModelRuntimeConfig } from '../../src/model-runtime/validation.js';

describe('mailbox-config (ADR 0048 H3)', () => {
  it('defaults to supersede for compatibility', () => {
    expect(normalizeMailboxConfig()).toEqual(DEFAULT_MAILBOX_CONFIG);
  });

  it('normalizes fifo mode and timing fields', () => {
    expect(normalizeMailboxConfig({ groupMode: 'fifo', ttlMs: 60_000 })).toEqual({
      groupMode: 'fifo',
      ttlMs: 60_000,
      maxQueuedTurns: 5,
      merge: DEFAULT_MAILBOX_MERGE_CONFIG,
      live: DEFAULT_MAILBOX_LIVE_CONFIG,
    });
  });

  it('defaults the ADR 0038 danmaku window to pick-one / 10s / 15s and normalizes it', () => {
    expect(normalizeMailboxConfig().live).toEqual({ mode: 'pick-one', windowMs: 10_000, minIntervalMs: 15_000 });
    expect(normalizeMailboxConfig({ live: { mode: 'summary', windowMs: 5_000, minIntervalMs: -1 } }).live)
      .toEqual({ mode: 'summary', windowMs: 5_000, minIntervalMs: 15_000 });
    expect(normalizeMailboxConfig({ live: { mode: 'all' as 'summary' } }).live.mode).toBe('pick-one');
  });

  it('validates danmaku window fields', () => {
    expect(validateMailboxConfig({
      live: { mode: 'all' as 'summary', windowMs: -1, minIntervalMs: Number.POSITIVE_INFINITY },
    })).toEqual([
      'ai.agent.mailbox.live.mode must be pick-one or summary',
      'ai.agent.mailbox.live.windowMs must be a non-negative number',
      'ai.agent.mailbox.live.minIntervalMs must be a non-negative number',
    ]);
  });

  it('turns the ADR 0038 merge window on by default and normalizes its timings', () => {
    expect(normalizeMailboxConfig().merge).toEqual({ enabled: true, quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 5 });
    expect(normalizeMailboxConfig({ merge: { enabled: true, quietMs: 3_000, maxWaitMs: 1_000, maxSenders: 0 } }).merge)
      .toEqual({ enabled: true, quietMs: 3_000, maxWaitMs: 3_000, maxSenders: 5 });
  });

  it('validates merge window fields', () => {
    expect(validateMailboxConfig({
      merge: { enabled: 'yes' as unknown as boolean, quietMs: -1, maxWaitMs: Number.NaN, maxSenders: 1.5 },
    })).toEqual([
      'ai.agent.mailbox.merge.enabled must be a boolean',
      'ai.agent.mailbox.merge.quietMs must be a non-negative number',
      'ai.agent.mailbox.merge.maxWaitMs must be a non-negative number',
      'ai.agent.mailbox.merge.maxSenders must be a positive integer',
    ]);
  });

  it('validates invalid config', () => {
    expect(validateMailboxConfig({ groupMode: 'parallel' as 'fifo' })).toEqual([
      'ai.agent.mailbox.groupMode must be supersede or fifo',
    ]);
  });

  it('fails startup on the renamed ai.agent.inboundQueue with a migration message (Q4)', () => {
    const errors = validateModelRuntimeConfig({ agent: { inboundQueue: { groupMode: 'fifo' } } }, 'host');
    expect(errors).toContain(MAILBOX_MIGRATION_HINT);
    expect(MAILBOX_MIGRATION_HINT).toContain('ai.agent.mailbox');
    expect(validateModelRuntimeConfig({ agent: { mailbox: { groupMode: 'fifo' } } }, 'host')).toEqual([]);
    expect(validateModelRuntimeConfig({ agent: { mailbox: { ttlMs: -1 } } }, 'host'))
      .toEqual(['ai.agent.mailbox.ttlMs must be a non-negative number']);
  });
});
