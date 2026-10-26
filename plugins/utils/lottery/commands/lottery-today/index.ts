import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { formatDailyReportText, loadTodayReport } from '../../src/recommend/report.js';
import type { LotteryConfig } from '../../src/command-helpers.js';
import { lotteryRuntimeToken } from '../../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: '查看今日已发布的推荐报告',
  descriptionI18n: { en: 'Show today published recommendation report' },
  async execute({ use, locale, formatCommand }) {
    const { db } = use(lotteryRuntimeToken);
    const report = await loadTodayReport(db);
    if (!report) {
      const command = formatCommand('lottery');
      return command ? t(locale, 'noReportCommand', { command }) : t(locale, 'noReport');
    }
    return formatDailyReportText(report, '');
  },
});
