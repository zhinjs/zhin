import type { ResolvedScatterJob } from '../resolvers/scatter.js';
import type { ScatterRunState } from '../types.js';
import {
  getDailySlotSeconds,
  getScatterMeta,
  listScatterSlotsForDay,
  slotToDate,
} from '../resolvers/scatter.js';
import { formatDateKey } from '../utils/timezone.js';
import { advanceScatterState, setScatterState } from '../utils/scatter-state.js';

export interface ScatterExecutionPlan {
  shouldRunHandler: boolean;
  scheduledAt: Date;
  scatterIndex: number;
  scatterCount: number;
  scatterRemaining: number;
  scatterSlotsToday: Date[];
  nextState: ScatterRunState;
}

export function planScatterExecution(
  job: ResolvedScatterJob,
  jobId: string,
  state: ScatterRunState,
  scheduledAt: Date,
  now: Date,
  graceMs: number,
): ScatterExecutionPlan {
  const dateKey = formatDateKey(scheduledAt, job.timezone);
  const slots = getDailySlotSeconds(job, jobId, dateKey);
  const firedCount = state.dateKey === dateKey ? state.firedCount : 0;
  const allSlotsToday = listScatterSlotsForDay(job, jobId, dateKey);
  const misfire = job.misfire ?? 'fire';
  const lateness = now.getTime() - scheduledAt.getTime();

  const baseMeta = getScatterMeta(scheduledAt, job, state);

  if (misfire === 'fire' || lateness <= graceMs) {
    return {
      shouldRunHandler: true,
      scheduledAt,
      scatterIndex: baseMeta.scatterIndex,
      scatterCount: baseMeta.scatterCount,
      scatterRemaining: baseMeta.scatterRemaining,
      scatterSlotsToday: allSlotsToday,
      nextState: advanceScatterState(scheduledAt, job.timezone, state),
    };
  }

  if (misfire === 'skip') {
    return {
      shouldRunHandler: false,
      scheduledAt,
      scatterIndex: baseMeta.scatterIndex,
      scatterCount: baseMeta.scatterCount,
      scatterRemaining: baseMeta.scatterRemaining,
      scatterSlotsToday: allSlotsToday,
      nextState: advanceScatterState(scheduledAt, job.timezone, state),
    };
  }

  const cutoff = now.getTime() - graceMs;
  let lastExpiredIndex = -1;
  for (let i = firedCount; i < slots.length; i++) {
    const slotTime = slotToDate(dateKey, slots[i], job.timezone).getTime();
    if (slotTime <= cutoff) {
      lastExpiredIndex = i;
    }
  }

  if (lastExpiredIndex < 0) {
    return {
      shouldRunHandler: true,
      scheduledAt,
      scatterIndex: baseMeta.scatterIndex,
      scatterCount: baseMeta.scatterCount,
      scatterRemaining: baseMeta.scatterRemaining,
      scatterSlotsToday: allSlotsToday,
      nextState: advanceScatterState(scheduledAt, job.timezone, state),
    };
  }

  const coalescedAt = slotToDate(dateKey, slots[lastExpiredIndex], job.timezone);
  const coalescedIndex = lastExpiredIndex + 1;
  return {
    shouldRunHandler: true,
    scheduledAt: coalescedAt,
    scatterIndex: coalescedIndex,
    scatterCount: job.count,
    scatterRemaining: Math.max(0, job.count - lastExpiredIndex),
    scatterSlotsToday: allSlotsToday,
    nextState: setScatterState(dateKey, coalescedIndex),
  };
}
