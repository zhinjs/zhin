import { createMessages, formatDateTime } from '../src/i18n.js';

it('keeps locales explicit and interpolates user values exactly once', async () => {
  const t = createMessages({ greet: { 'zh-CN': '你好 {name}', en: 'Hello {name}' } });
  expect(await Promise.all([Promise.resolve(t('en', 'greet', { name: '{name}<script>' })),
    Promise.resolve(t('zh-CN', 'greet', { name: '世界' }))])).toEqual(['Hello {name}<script>', '你好 世界']);
});

it('rejects incomplete templates instead of silently hiding missing translations or values', () => {
  expect(() => createMessages({ count: { 'zh-CN': '{count} 项', en: 'Items' } })).toThrow('Invalid bilingual');
  const t = createMessages({ count: { 'zh-CN': '{count} 项', en: '{count} items ({count})' } });
  expect(() => t('en', 'count')).toThrow('Missing message value');
  expect(t(undefined, 'count', { count: 2 })).toBe('2 项');
});

describe('formatDateTime (#1250 cli-datetime-us-locale)', () => {
  const at = Date.UTC(2026, 10, 14, 16, 15, 56);
  it('is YYYY-MM-DD HH:mm:ss, 24-hour, in both languages', () => {
    expect(formatDateTime(at, 'zh-CN', { timeZone: 'Asia/Shanghai' })).toBe('2026-11-15 00:15:56');
    expect(formatDateTime(at, 'en', { timeZone: 'Asia/Shanghai' })).toBe('2026-11-15 00:15:56');
    expect(formatDateTime(new Date(Date.UTC(2026, 10, 16, 13, 0, 0)), 'zh-CN', { timeZone: 'UTC' })).toBe('2026-11-16 13:00:00');
    expect(formatDateTime(at, undefined, { timeZone: 'UTC', part: 'date' })).toBe('2026-11-14');
    expect(formatDateTime(at, undefined, { timeZone: 'UTC', part: 'time' })).toBe('16:15:56');
    expect(formatDateTime(Number.NaN)).toBe('-');
    expect(formatDateTime(at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
  });
});

describe('formatDateTime default zone (review of #1288)', () => {
  it('follows a changed process TZ instead of a cached default', () => {
    const previous = process.env.TZ;
    const at = Date.UTC(2026, 10, 14, 16, 15, 56);
    try {
      process.env.TZ = 'UTC';
      expect(formatDateTime(at)).toBe('2026-11-14 16:15:56');
      process.env.TZ = 'Asia/Shanghai';
      expect(formatDateTime(at)).toBe('2026-11-15 00:15:56');
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });
});
