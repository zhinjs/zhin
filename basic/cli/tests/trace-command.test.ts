import { describe, expect, it } from 'vitest';
import { parseTraceTime, traceCommand } from '../src/commands/trace.js';

describe('zhin trace filters (#728)', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  it('parses relative, ISO and epoch times', () => {
    expect(parseTraceTime(undefined)).toBeUndefined();
    expect(parseTraceTime('2h', now)).toBe(now - 2 * 3_600_000);
    expect(parseTraceTime('7d', now)).toBe(now - 7 * 86_400_000);
    expect(parseTraceTime('30m', now)).toBe(now - 30 * 60_000);
    expect(parseTraceTime('2026-10-14T08:00:00Z')).toBe(Date.parse('2026-10-14T08:00:00Z'));
    expect(parseTraceTime('1760400000000')).toBe(1760400000000);
    expect(() => parseTraceTime('yesterday-ish')).toThrow(/无法解析时间/);
  });

  it('exposes session and time filters', () => {
    const flags = traceCommand.options.map((option) => option.long);
    expect(flags).toEqual(expect.arrayContaining(['--session', '--since', '--until', '--sessions', '--dir', '--limit']));
  });
});
