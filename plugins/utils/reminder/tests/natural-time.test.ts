import { describe, expect, it, vi } from 'vitest';
import { MAX_DELAY_SECONDS } from '../src/timing.js';
import { ReminderTimeInputError, formatReminderTime, parseNaturalReminderTime } from '../src/natural-time.js';

const now = Date.parse('2026-10-19T00:00:00Z');
const parse = (expression: string, timezone = 'Asia/Shanghai', base = now) => parseNaturalReminderTime(expression, { now: base, timezone });

describe('finite natural reminder time grammar', () => {
  it.each([
    ['十分钟后', 600], ['10分钟后', 600], ['两小时后', 7200], ['二小时后', 7200], ['一分钟后', 60],
    ['一秒后', 1], ['1秒钟后', 1], ['十五分后', 900], ['三百六十五天后', MAX_DELAY_SECONDS],
    ['一千零一秒后', 1001], ['两千两百二十二秒后', 2222], ['一万零二十秒后', 10020],
    ['三千一百五十三万六千秒后', MAX_DELAY_SECONDS], ['一十秒后', 10], ['20 小时 后', 72000],
  ])('resolves %s as a fixed duration', (expression, seconds) => {
    expect(parse(String(expression))).toEqual({ at: now + Number(seconds) * 1000, timezone: 'Asia/Shanghai', expression });
  });

  it.each([
    ['今天九点', '2026-10-19T01:00:00Z'], ['明天九点', '2026-10-20T01:00:00Z'],
    ['后天09:30', '2026-10-21T01:30:00Z'], ['明天九点半', '2026-10-20T01:30:00Z'],
    ['明天九点三十分二十秒', '2026-10-20T01:30:20Z'], ['明天09:30:20', '2026-10-20T01:30:20Z'],
    ['明天下午两点', '2026-10-20T06:00:00Z'], ['明天晚上九点半', '2026-10-20T13:30:00Z'],
    ['明天上午九点', '2026-10-20T01:00:00Z'], ['明天凌晨零点', '2026-10-19T16:00:00Z'],
    ['明天中午一点', '2026-10-20T05:00:00Z'], ['明天中午十二点', '2026-10-20T04:00:00Z'],
    ['明天下午十二点', '2026-10-20T04:00:00Z'], ['明天00:00', '2026-10-19T16:00:00Z'],
  ])('resolves %s in the configured timezone', (expression, expected) => {
    expect(parse(expression).at).toBe(Date.parse(expected));
  });

  it('preserves explicit offset authority while displaying the configured timezone', () => {
    expect(parse(' 2026-10-20T09:00:00-07:00 ')).toEqual({ at: Date.parse('2026-10-20T16:00:00Z'),
      timezone: 'Asia/Shanghai', expression: '2026-10-20T09:00:00-07:00' });
    expect(parse('2026-10-20T00:00:00.250Z').at).toBe(Date.parse('2026-10-20T00:00:00.250Z'));
    expect(formatReminderTime(Date.parse('2026-10-20T16:00:00Z'), 'Asia/Shanghai'))
      .toBe('2026-10-21 00:00:00 UTC+08:00 (Asia/Shanghai)');
  });

  it('uses local dates across UTC midnight, years and leap days', () => {
    expect(parse('明天九点', 'America/Los_Angeles', Date.parse('2026-01-01T02:00:00Z')).at)
      .toBe(Date.parse('2026-01-01T17:00:00Z'));
    expect(parse('明天九点', 'Asia/Tokyo', Date.parse('2026-12-31T14:00:00Z')).at)
      .toBe(Date.parse('2027-01-01T00:00:00Z'));
    expect(parse('后天九点', 'UTC', Date.parse('2028-02-28T01:00:00Z')).at)
      .toBe(Date.parse('2028-03-01T09:00:00Z'));
  });

  it('ignores the host timezone and preserves fractional-hour zone offsets', () => {
    vi.stubEnv('TZ', 'Pacific/Honolulu');
    try {
      expect(parse('明天九点', 'Asia/Kathmandu').at).toBe(Date.parse('2026-10-20T03:15:00Z'));
      expect(formatReminderTime(Date.parse('2026-10-20T03:15:00Z'), 'Asia/Kathmandu'))
        .toBe('2026-10-20 09:00:00 UTC+05:45 (Asia/Kathmandu)');
    } finally { vi.unstubAllEnvs(); }
  });

  it('requires an explicit day instead of guessing and never rolls a past today forward', () => {
    expect(() => parse('九点')).toThrow(ReminderTimeInputError);
    expect(() => parse('今天七点')).toThrow('不会自动改到明天');
    expect(() => parse('今天08:00')).toThrow('至少 1 秒');
    expect(() => parse('2026-10-18T00:00:00Z')).toThrow('至少 1 秒');
  });

  it('rejects DST gaps and folds and accepts the explicit offset alternatives', () => {
    const spring = Date.parse('2026-03-07T12:00:00Z');
    expect(() => parse('明天02:30', 'America/New_York', spring)).toThrow('不存在');
    const autumn = Date.parse('2026-10-31T12:00:00Z');
    expect(() => parse('明天01:30', 'America/New_York', autumn)).toThrow('出现两次');
    const first = parse('2026-11-01T01:30:00-04:00', 'America/New_York', autumn);
    const second = parse('2026-11-01T01:30:00-05:00', 'America/New_York', autumn);
    expect(second.at - first.at).toBe(3_600_000);
    expect(formatReminderTime(first.at, first.timezone)).toContain('UTC-04:00');
    expect(formatReminderTime(second.at, second.timezone)).toContain('UTC-05:00');
    expect(() => parse('明天02:15', 'Australia/Lord_Howe', Date.parse('2026-10-03T00:00:00Z'))).toThrow('不存在');
    expect(() => parse('明天01:45', 'Australia/Lord_Howe', Date.parse('2026-04-04T00:00:00Z'))).toThrow('出现两次');
    expect(() => parse('明天九点', 'Pacific/Apia', Date.parse('2011-12-29T12:00:00Z'))).toThrow('不存在');
  });

  it('distinguishes a fixed day from the next local day across DST', () => {
    const base = Date.parse('2026-03-07T14:00:00Z');
    expect(parse('一天后', 'America/New_York', base).at).toBe(base + 86_400_000);
    expect(parse('明天九点', 'America/New_York', base).at).toBe(base + 23 * 3_600_000);
  });

  it('enforces inclusive one-second and 365-day boundaries', () => {
    expect(parse('1秒后').at - now).toBe(1000);
    expect(parse(`${MAX_DELAY_SECONDS}秒后`).at - now).toBe(MAX_DELAY_SECONDS * 1000);
    expect(() => parse('0秒后')).toThrow(ReminderTimeInputError);
    expect(() => parse(`${MAX_DELAY_SECONDS + 1}秒后`)).toThrow('365 天');
    expect(() => parse('2027-10-19T00:00:00.001Z')).toThrow('365 天');
    expect(() => parse('2026-10-19T00:00:01.000Z', 'UTC', now + 1)).toThrow('至少 1 秒');
  });

  it.each(['每天九点', '每周一', '下周五九点', '2026-02-30T09:00:00Z', '2026-10-20T24:00:00Z',
    '2026-10-20T09:00:00', '明天24:00', '明天09:60', '明天九点六十分', '明天九点六十分一秒',
    '明天晚上十二点', '明天上午十二点', '明天下午十八点', '明天中午九点', '半小时后', '1.5小时后',
    '-1秒后', '一百二秒后', '一一秒后', '十百秒后', '两十秒后', '一亿秒后', '999999999999999999999999秒后',
    '一分钟后\n', '', ' ', '一'.repeat(201)])('rejects unsupported, invalid or ambiguous input %s', expression => {
    expect(() => parse(expression)).toThrow(ReminderTimeInputError);
  });

  it('validates options and formatter inputs without leaking raw errors', () => {
    for (const timezone of ['', 'Invalid/Zone', ' Asia/Shanghai', '+08:00', 'x'.repeat(101)]) {
      expect(() => parse('十分钟后', timezone)).toThrow(ReminderTimeInputError);
      expect(() => formatReminderTime(now, timezone)).toThrow('IANA');
    }
    for (const base of [NaN, Infinity, 1.25, Number.MAX_SAFE_INTEGER]) {
      expect(() => parse('十分钟后', 'UTC', base)).toThrow(ReminderTimeInputError);
      expect(() => formatReminderTime(base, 'UTC')).toThrow(ReminderTimeInputError);
    }
  });
});


describe('English natural reminder grammar', () => {
  const now = Date.parse('2026-01-01T08:00:00Z');
  it.each([
    ['in 10 minutes', 600_000], ['in 1 second', 1000], ['IN 2 HOURS', 7_200_000], ['in 1 day', 86_400_000],
  ])('parses %s with the existing bounded duration semantics', (expression, delay) => {
    expect(parseNaturalReminderTime(expression, { now, timezone: 'UTC', locale: 'en' }).at).toBe(now + delay);
  });
  it.each([
    ['today at 09:00', '2026-01-01T09:00:00Z'],
    ['tomorrow at 09:00:30', '2026-01-02T09:00:30Z'],
    ['the day after tomorrow at 09:00', '2026-01-03T09:00:00Z'],
  ])('resolves %s in the configured zone', (expression, expected) => {
    expect(parseNaturalReminderTime(expression, { now, timezone: 'UTC', locale: 'en' }).at).toBe(Date.parse(expected));
  });
  it('accepts only the selected natural language while keeping ISO common', () => {
    expect(() => parseNaturalReminderTime('十分钟后', { now, timezone: 'UTC', locale: 'en' })).toThrow('not supported');
    expect(() => parseNaturalReminderTime('in 10 minutes', { now, timezone: 'UTC', locale: 'zh-CN' })).toThrow('暂不支持');
    for (const locale of ['en', 'zh-CN'] as const) expect(parseNaturalReminderTime('2026-01-02T09:00:00Z', { now, timezone: 'UTC', locale }).at).toBe(Date.parse('2026-01-02T09:00:00Z'));
  });
  it('does not bypass DST gaps, folds, time range or recurring restrictions', () => {
    expect(() => parseNaturalReminderTime('tomorrow at 02:30', { now: Date.parse('2026-03-07T12:00:00Z'), timezone: 'America/New_York', locale: 'en' })).toThrow('does not exist');
    expect(() => parseNaturalReminderTime('tomorrow at 01:30', { now: Date.parse('2026-10-31T12:00:00Z'), timezone: 'America/New_York', locale: 'en' })).toThrow('occurs twice');
    expect(() => parseNaturalReminderTime('in 366 days', { now, timezone: 'UTC', locale: 'en' })).toThrow('365 days');
    expect(() => parseNaturalReminderTime('every day at 09:00', { now, timezone: 'UTC', locale: 'en' })).toThrow('not supported');
  });
});
