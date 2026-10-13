import { defineSchedule } from '@zhin.js/schedule-feature';
import { reminderServiceToken } from '../../src/runtime.js';

export default defineSchedule({
  cron: '*/5 * * * * *',
  description: '扫描持久提醒；周期错过轮次不补发',
  execute: context => context.use(reminderServiceToken).tick(),
});
