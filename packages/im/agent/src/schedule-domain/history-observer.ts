import { getLogger } from '@zhin.js/logger';
import type { ScheduleHistoryEvent, ScheduleHistoryObserver, ScheduleObservationOwner } from './execution-history.js';

const logger = getLogger('schedule-history');

/** Forwards facts to the single history owner; contains no queue, buffer or IO lifetime. */
export class ScheduleHistoryReporter {
  constructor(readonly observer?: ScheduleHistoryObserver, readonly observations?: ScheduleObservationOwner) {}

  observe(event: ScheduleHistoryEvent): void {
    if (this.observations && this.observations !== this.observer) {
      try {
        const observation = this.observations.observe(event);
        if (observation) void observation.catch(() => logger.warn('Schedule execution history is incomplete'));
      }
      catch { logger.warn('Schedule execution history is incomplete'); }
    }
    try {
      const observation = this.observer?.observe(event);
      if (observation) void observation.catch(() => logger.warn('Schedule execution history is incomplete'));
    } catch { logger.warn('Schedule execution history is incomplete'); }
  }

  audit(input: Parameters<ScheduleObservationOwner['audit']>[0]): void {
    try { this.observations?.audit(input); }
    catch { logger.warn('Schedule audit recording failed'); }
  }

  activity(input: Parameters<ScheduleObservationOwner['activity']>[0]): void {
    try { this.observations?.activity(input); }
    catch { logger.warn('Schedule activity recording failed'); }
  }
}
