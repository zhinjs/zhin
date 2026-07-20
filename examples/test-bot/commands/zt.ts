import { defineCommand } from '@zhin.js/command';
import { raw } from '@zhin.js/core/runtime';
import { buildZtReportHtml, ZT_REPORT_CANVAS } from '../lib/zt-report-card.js';
import { buildZtReportText, collectZtFallbackData, collectZtReportData } from '../lib/zt-report-data.js';

/** Runtime 环境无 legacy Plugin root；报告数据只用它做计数展示。 */
const rootStub = { adapters: [], children: [] } as never;

/** Runtime zt：富系统报告卡（legacy /zt 同款布局）。 */
export default defineCommand({
  description: '系统状态卡片（富报告）',
  execute: () => {
    let data;
    try {
      data = collectZtReportData(rootStub);
    } catch {
      data = collectZtFallbackData(rootStub);
    }
    return raw({
      type: 'html',
      data: {
        html: buildZtReportHtml(data),
        width: 540,
        backgroundColor: ZT_REPORT_CANVAS,
        fileName: 'system-status.png',
        text: buildZtReportText(data),
      },
    });
  },
});
