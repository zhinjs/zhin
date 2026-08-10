import { defineCommand } from 'zhin.js/command';
import { messageGatewayToken, raw } from 'zhin.js/core/runtime';
import { buildZtReportHtml, ZT_REPORT_CANVAS } from '../lib/zt-report-card.js';
import {
  buildZtReportText,
  collectZtFallbackData,
  collectZtReportData,
  type ZtFrameworkCounts,
} from '../lib/zt-report-data.js';

/** install() 提供的是 ImRuntime；用 inventory 取与 Console /api/stats 同源计数。 */
type RuntimeInventoryHost = {
  inventory(): {
    plugins: number;
    endpoints: { total: number; online: number };
  };
};

function readFrameworkCounts(use: (token: typeof messageGatewayToken) => unknown): ZtFrameworkCounts {
  try {
    const host = use(messageGatewayToken) as RuntimeInventoryHost;
    const inventory = host.inventory();
    return {
      // Runtime 无独立 Adapter 列表；展示用 endpoint 总数（Console endpoints.total）。
      adapters: inventory.endpoints.total,
      plugins: inventory.plugins,
    };
  } catch {
    return { adapters: 0, plugins: 0 };
  }
}

/** Runtime zt：富系统报告卡（legacy /zt 同款布局）。 */
export default defineCommand({
  description: '系统状态卡片（富报告）',
  execute: (context) => {
    const counts = readFrameworkCounts((token) => context.use(token));
    let data;
    try {
      data = collectZtReportData(counts);
    } catch {
      data = collectZtFallbackData(counts);
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
