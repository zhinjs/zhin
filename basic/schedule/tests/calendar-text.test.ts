import { describe, expect, it } from 'vitest';
import { formatLunarText, formatSolarText } from '../src/utils/calendar-text.js';

describe('calendar-text', () => {
  it('formatSolarText uses timezone', () => {
    const text = formatSolarText(new Date('2025-06-27T12:00:00+08:00'), 'Asia/Shanghai');
    expect(text).toBe('2025年6月27日');
  });

  it('formatLunarText returns empty string outside lunar table range', () => {
    const text = formatLunarText(new Date('1800-01-01T00:00:00+08:00'), 'Asia/Shanghai');
    expect(text).toBe('');
  });

  it('formatLunarText returns ganzhi date inside range', () => {
    const text = formatLunarText(new Date('2025-06-27T12:00:00+08:00'), 'Asia/Shanghai');
    expect(text).toContain('年');
    expect(text).toContain('月');
  });
});
