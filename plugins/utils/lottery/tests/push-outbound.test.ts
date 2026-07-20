import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  getLotteryOutboundPush,
  pushLotteryReport,
  registerLotteryOutboundPush,
  setLotteryOutboundPush,
} from '../src/push.js';

describe('lottery OutboundHost push', () => {
  afterEach(() => {
    setLotteryOutboundPush(null);
  });

  it('uses OutboundHost callback when wired', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    setLotteryOutboundPush(send);
    expect(getLotteryOutboundPush()).toBe(send);
    await pushLotteryReport('hello report');
    expect(send).toHaveBeenCalledWith('hello report');
  });

  it('no-ops when neither outbound nor plugin', async () => {
    await expect(pushLotteryReport('x')).resolves.toBeUndefined();
  });

  it('does not let an old generation clear the current callback', () => {
    const previous = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn().mockResolvedValue(undefined);
    const disposePrevious = registerLotteryOutboundPush(previous);
    const disposeNext = registerLotteryOutboundPush(next);

    disposePrevious();
    expect(getLotteryOutboundPush()).toBe(next);
    disposeNext();
    expect(getLotteryOutboundPush()).toBeNull();
  });

  it('restores the previous callback when replacement preparation rolls back', () => {
    const previous = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn().mockResolvedValue(undefined);
    const disposePrevious = registerLotteryOutboundPush(previous);
    const disposeNext = registerLotteryOutboundPush(next);

    disposeNext();
    expect(getLotteryOutboundPush()).toBe(previous);
    disposePrevious();
  });
});
