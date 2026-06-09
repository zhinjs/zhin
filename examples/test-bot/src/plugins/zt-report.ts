import { segment } from "zhin.js";
import { buildZtReportHtml, ZT_REPORT_CANVAS } from "./zt-report-card.js";
import type { ZtReportData } from "./zt-report-data.js";

export type { ZtReportData } from "./zt-report-data.js";
export {
  buildZtReportText,
  collectZtFallbackData,
  collectZtReportData,
} from "./zt-report-data.js";
export { buildZtReportHtml, ZT_REPORT_CANVAS } from "./zt-report-card.js";
export type { ZtReportCardProps } from "./zt-report-card.js";

/** 系统状态卡片出站（html 段；装 html-renderer 自动出图，否则 core 剥离文本） */
export function ztReportReply(data: ZtReportData, options?: { subtitle?: string }) {
  return segment.html({
    html: buildZtReportHtml(data, options),
    width: 540,
    backgroundColor: ZT_REPORT_CANVAS,
    fileName: "system-status.png",
  });
}
