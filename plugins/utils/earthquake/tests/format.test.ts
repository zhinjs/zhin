import { describe, expect, it } from 'vitest';
import { formatEventTime } from '../src/format.js';

describe('earthquake event time (#1250)', () => {
  it('uses the repository date format in the configured zone', () => {
    const time = Date.parse('2026-01-05T17:00:00Z');
    expect(formatEventTime(time, 'Asia/Shanghai')).toBe('2026-01-06 01:00:00');
    expect(formatEventTime(time, 'UTC')).toBe('2026-01-05 17:00:00');
    // Midnight is 00, never the 24 some engines give with hour12: false.
    expect(formatEventTime(Date.parse('2026-01-05T16:00:00Z'), 'Asia/Shanghai')).toBe('2026-01-06 00:00:00');
  });
});
