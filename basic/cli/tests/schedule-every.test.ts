/** #1250 b113: `zhin schedule --every` is bounded locally to 365 days, like `--at` and the instance. */
import { describe, expect, it } from 'vitest';
import { MAX_SCHEDULE_AT_DELAY_MS, MAX_SCHEDULE_EVERY_MS, parseEveryMs } from '../src/commands/schedule.js';

describe('parseEveryMs (#1250 b113)', () => {
  it('parses s / m / h / d intervals', () => {
    expect(parseEveryMs('10s')).toBe(10_000);
    expect(parseEveryMs('30m')).toBe(1_800_000);
    expect(parseEveryMs('1h')).toBe(3_600_000);
    expect(parseEveryMs('1D')).toBe(86_400_000);
  });

  it('accepts 365 days, the same bound as --at and the instance', () => {
    expect(MAX_SCHEDULE_EVERY_MS).toBe(MAX_SCHEDULE_AT_DELAY_MS);
    expect(parseEveryMs('365d')).toBe(MAX_SCHEDULE_EVERY_MS);
    expect(parseEveryMs('8760h')).toBe(MAX_SCHEDULE_EVERY_MS);
  });

  it.each(['366d', '8761h', '99999999999999999999d', '100000000000000s'])('refuses %s before any request', value => {
    expect(() => parseEveryMs(value)).toThrow('执行间隔（--every）最多 365 天（与实例的上限相同）');
  });

  it('refuses a zero interval and a bad format', () => {
    expect(() => parseEveryMs('0s')).toThrow('执行间隔（--every）至少 1 秒');
    expect(() => parseEveryMs('1w')).toThrow('Invalid --every format');
  });
});
