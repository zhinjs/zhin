import { defineCommand } from "zhin.js/command";
import { outboundMessageToken, raw } from "zhin.js/core/runtime";
import {
  buildZtReportHtml,
  ZT_REPORT_CANVAS,
} from "../../lib/zt-report-card.js";
import {
  buildZtReportText,
  collectZtFallbackData,
  collectZtReportData,
  type ZtFrameworkCounts,
} from "../../lib/zt-report-data.js";

/** install() 提供的是 ImRuntime；用 inventory 取与 Console /api/stats 同源计数。 */
type RuntimeInventoryHost = {
  inventory(): {
    plugins: number;
    endpoints: { total: number; online: number };
  };
};

function readFrameworkCounts(
  use: (token: typeof outboundMessageToken) => unknown
): ZtFrameworkCounts {
  try {
    const host = use(outboundMessageToken) as RuntimeInventoryHost;
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

/**
 * Runtime zt：富系统报告卡（legacy /zt 同款布局）。
 *
 * 卡片含主机名、系统与内核版本、硬件容量、网卡名和打码后的网段，因此只允许 owner 或管理员
 * （zhin 聊天角色 `admin`，owner 包含 admin）使用；要求全局角色可改成 `admin@global`。
 * 照抄时不要去掉这条限制，也不要把 MAC / 完整 IP 加回卡片。
 */
export default defineCommand({
  description: "系统状态卡片（富报告，仅 owner / 管理员）",
  permit: ["admin"],
  execute: async (context) => {
    const counts = readFrameworkCounts((token) => context.use(token));
    let data;
    try {
      data = await collectZtReportData(counts);
    } catch {
      data = collectZtFallbackData(counts);
    }
    return raw({
      type: "html",
      data: {
        html: await buildZtReportHtml(data),
        width: 540,
        backgroundColor: ZT_REPORT_CANVAS,
        fileName: "system-status.png",
        text: buildZtReportText(data),
      },
    });
  },
});
