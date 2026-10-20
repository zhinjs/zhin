import { isRssQuietMinute, parseQuietHours } from '../src/quiet-hours.js';

const quiet = { timezone: 'Asia/Shanghai', start: '22:00', end: '08:00' };
describe('RSS actual local-minute quiet policy', () => {
  it.each([
    ['2026-10-20T13:59:00Z', false], ['2026-10-20T14:00:00Z', true],
    ['2026-10-20T23:59:00Z', true], ['2026-10-21T00:00:00Z', false],
  ])('checks a midnight-spanning interval at %s', (at, expected) => {
    expect(isRssQuietMinute(quiet, Date.parse(at))).toBe(expected);
  });
  it('uses the configured zone rather than the machine zone, with inclusive start/exclusive end', () => {
    const day = { ...quiet, start: '09:00', end: '12:00' };
    expect(isRssQuietMinute(day, Date.parse('2026-10-20T01:00:00Z'))).toBe(true);
    expect(isRssQuietMinute(day, Date.parse('2026-10-20T04:00:00Z'))).toBe(false);
    expect(isRssQuietMinute({ ...day, timezone: 'America/New_York' }, Date.parse('2026-10-20T01:00:00Z'))).toBe(false);
  });
  it('observes both repeated fall-back minutes, without choosing an ambiguous next Date', () => {
    const repeated = { timezone: 'America/New_York', start: '01:15', end: '01:45' };
    expect(isRssQuietMinute(repeated, Date.parse('2026-11-01T05:30:00Z'))).toBe(true);
    expect(isRssQuietMinute(repeated, Date.parse('2026-11-01T06:30:00Z'))).toBe(true);
    expect(isRssQuietMinute(repeated, Date.parse('2026-11-01T06:45:00Z'))).toBe(false);
  });
  it('does not invent a spring-forward local minute that did not occur', () => {
    const missing = { timezone: 'America/New_York', start: '02:00', end: '03:00' };
    expect(isRssQuietMinute(missing, Date.parse('2026-03-08T06:59:00Z'))).toBe(false);
    expect(isRssQuietMinute(missing, Date.parse('2026-03-08T07:00:00Z'))).toBe(false);
  });
  it.each([{}, { quietTimezone: '', quietStart: '', quietEnd: '' }, { quietTimezone: '  ', quietStart: undefined, quietEnd: '\t' }])('normalizes all omitted or blank fields to off: %j', parameters => {
    expect(parseQuietHours(parameters)).toBeUndefined();
  });
  it('normalizes three complete flat form inputs', () => {
    expect(parseQuietHours({ quietTimezone: ' Asia/Shanghai ', quietStart: '22:00', quietEnd: '08:00' })).toEqual(quiet);
  });
  it.each([
    { quietTimezone: 'Asia/Shanghai' }, { quietTimezone: 'Asia/Shanghai', quietStart: '', quietEnd: '08:00' },
    { quietTimezone: null, quietStart: '22:00', quietEnd: '08:00' },
    { quietTimezone: '+08:00', quietStart: '22:00', quietEnd: '08:00' },
    { quietTimezone: 'Not/AZone', quietStart: '22:00', quietEnd: '08:00' },
    { quietTimezone: 'UTC', quietStart: '9:00', quietEnd: '12:00' },
    { quietTimezone: 'UTC', quietStart: '24:00', quietEnd: '12:00' },
    { quietTimezone: 'UTC', quietStart: '12:00', quietEnd: '12:00' },
    { quietTimezone: 'UTC', quietStart: '12:00', quietEnd: '12:60' },
  ])('rejects partial, invalid or ambiguous configuration %j', parameters => {
    expect(() => parseQuietHours(parameters)).toThrow(TypeError);
  });
});
