import { defineSchedule } from '@zhin.js/schedule-feature';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineSchedule({
  cron: '0 * * * * *',
  description: '每分钟检查一次；到达 reportTime 后给已订阅用户私信当天记账日报，每人每天一次',
  execute: async (context) => {
    await context.use(ledgerServiceToken).runDailyReports();
  },
});
