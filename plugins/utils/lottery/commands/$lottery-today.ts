import { defineCommand } from 'zhin.js/command';
import { formatDailyReportText, loadTodayReport } from '../src/recommend/report.js';
import type { LotteryConfig } from '../src/command-helpers.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: 'Show today published recommendation report',
  async execute({ use }) {
    const { db } = use(lotteryRuntimeToken);
    const report = await loadTodayReport(db);
    if (!report) return '今日尚无推荐，可执行 lottery 或等待定时任务';
    return formatDailyReportText(report, '');
  },
});
