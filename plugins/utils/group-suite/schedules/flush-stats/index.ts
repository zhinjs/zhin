import { defineSchedule } from '@zhin.js/schedule-feature';
import { groupSuiteRuntimeToken } from '../../src/runtime-state.js';
import { flushStatsBuffer } from '../../src/stats-lib.js';

export default defineSchedule({
  cron: '*/10 * * * * *',
  description: 'Flush owner-scoped message count batches',
  execute(context) {
    return flushStatsBuffer(context.use(groupSuiteRuntimeToken));
  },
});
