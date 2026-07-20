import { defineCommand } from '@zhin.js/command';
import { formatDailyReportText, loadTodayReport } from '../src/recommend/report.js';
import { getLotteryDb, type LotteryConfig } from '../src/command-helpers.js';
import { resolveLotteryRuntime } from '../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: 'Show today published recommendation report',
  async execute({ owner, use }) {
    const db = resolveLotteryRuntime({ owner, use })?.db ?? getLotteryDb();
    if (!db) return '数据库未就绪';
    const report = await loadTodayReport(db);
    if (!report) return '今日尚无推荐，可执行 lottery 或等待定时任务';
    return formatDailyReportText(report, '');
  },
});
