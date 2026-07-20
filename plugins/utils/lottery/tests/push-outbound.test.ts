import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { setLotteryOutboundPush, pushLotteryReport, getLotteryOutboundPush } from '../src/push.js';

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
});
