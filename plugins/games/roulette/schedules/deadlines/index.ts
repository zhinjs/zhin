import { defineSchedule } from '@zhin.js/schedule-feature';
import { DEADLINE_CRON, runDeadlineSweep } from '../../src/deadline-job.js';

export default defineSchedule({
  cron: DEADLINE_CRON,
  description: '结束超时未开枪的回合和无人开始的房间',
  execute: (context) => runDeadlineSweep(context, Date.now()),
});
