import { describe, expect, it } from 'vitest';
import { isScheduleActivityFeedbackEnabled } from '../../src/activity-feedback/schedule-guard.js';

describe('isScheduleActivityFeedbackEnabled', () => {
  it('allows feedback for normal turns', () => {
    expect(isScheduleActivityFeedbackEnabled({ hookContext: {} } as any)).toBe(true);
    expect(isScheduleActivityFeedbackEnabled({} as any)).toBe(true);
  });

  it('blocks schedule turns unless explicitly enabled', () => {
    expect(
      isScheduleActivityFeedbackEnabled({
        hookContext: { scheduleJobId: 'sched_1' },
      } as any),
    ).toBe(false);
    expect(
      isScheduleActivityFeedbackEnabled({
        hookContext: { schedulePreview: true },
      } as any),
    ).toBe(false);
  });

  it('allows schedule turns when scheduleActivityFeedback is true', () => {
    expect(
      isScheduleActivityFeedbackEnabled({
        hookContext: {
          scheduleJobId: 'sched_1',
          scheduleActivityFeedback: true,
        },
      } as any),
    ).toBe(true);
  });
});
