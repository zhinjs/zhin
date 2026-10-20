import { describe, it, expect } from 'vitest';
import {
  inferScheduleKindFromCron,
  normalizeCronForScheduleKind,
  buildJobScheduleFromCronInput,
} from '../src/schedule-cron.js';

describe('schedule-cron', () => {
  it('solar + 1-5 推断为 workday', () => {
    expect(inferScheduleKindFromCron('solar', '0 8 * * 1-5')).toBe('workday');
    expect(inferScheduleKindFromCron(undefined, '0 0 9 * * 1-5')).toBe('workday');
  });

  it('显式 workday 规范化 cron 日/月/周为 *', () => {
    expect(normalizeCronForScheduleKind('workday', '0 8 * * 1-5')).toBe('0 0 8 * * *');
    expect(buildJobScheduleFromCronInput('workday', '0 0 9 * * *')).toEqual({
      kind: 'workday',
      cron: '0 0 9 * * *',
    });
  });

  it('solar 周一 cron 不自动改 kind', () => {
    expect(inferScheduleKindFromCron('solar', '0 0 9 * * 1')).toBe('solar');
  });
});
