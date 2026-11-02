import { getLogger } from '@zhin.js/logger';
import type { ScheduleHistoryEvent, ScheduleHistoryObserver } from './execution-history.js';

const logger = getLogger('schedule-history');

/** Forwards facts to the single history owner; contains no queue, buffer or IO lifetime. */
export class ScheduleHistoryReporter {
  constructor(readonly observer?: ScheduleHistoryObserver) {}

  observe(event: ScheduleHistoryEvent): void {
    try {
      const observation = this.observer?.observe(event);
      if (observation) void observation.catch(() => logger.warn('Schedule execution history is incomplete'));
    } catch { logger.warn('Schedule execution history is incomplete'); }
  }
}
