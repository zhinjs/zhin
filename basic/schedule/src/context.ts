import { getFestivalForDate } from './resolvers/holiday.js';
import type { JobContext, ScheduleKind } from './types.js';
import { formatLunarText, formatSolarText } from './utils/calendar-text.js';

export function buildJobContext(
  jobId: string,
  kind: ScheduleKind,
  scheduledAt: Date,
  timezone: string,
  scatter?: {
    scatterIndex: number;
    scatterCount: number;
    scatterRemaining?: number;
    scatterSlotsToday?: Date[];
  },
): JobContext {
  return {
    jobId,
    kind,
    scheduledAt,
    solarText: formatSolarText(scheduledAt, timezone),
    lunarText: formatLunarText(scheduledAt, timezone),
    festival: getFestivalForDate(scheduledAt, timezone),
    scatterIndex: scatter?.scatterIndex,
    scatterCount: scatter?.scatterCount,
    scatterRemaining: scatter?.scatterRemaining,
    scatterSlotsToday: scatter?.scatterSlotsToday,
  };
}
