import { describe, expect, it } from "vitest";
import { segment } from "zhin.js";
import { coerceHtmlSegmentsToText } from "../../../../packages/im/core/src/built/html-segment-fallback.js";
import { buildStatsRankReportData } from "../src/stats-data.js";
import { buildStatsRankHtml, STATS_REPORT_CANVAS } from "../src/stats-card.js";

function statsRankReply(data: ReturnType<typeof buildStatsRankReportData>) {
  return segment.html({
    html: buildStatsRankHtml(data),
    width: 540,
    backgroundColor: STATS_REPORT_CANVAS,
    fileName: "message-stats-rank.png",
  });
}

describe("stats outbound", () => {
  it("命令层返回 html 段", () => {
    const stats = new Map([
      ["u1", { name: "Alice", count: 120 }],
      ["u2", { name: "Bob", count: 80 }],
    ]);
    const data = buildStatsRankReportData(stats, "今日本群消息统计", 10, "u2");
    const reply = statsRankReply(data);
    expect(reply).toMatchObject({ type: "html" });
    expect(reply.data.html).toContain("今日本群消息统计");
    expect(reply.data.html).toContain("Alice");
  });

  it("无 renderer 时自动剥离文本含标题与数字", () => {
    const stats = new Map([
      ["u1", { name: "Alice", count: 120 }],
      ["u2", { name: "Bob", count: 80 }],
    ]);
    const data = buildStatsRankReportData(stats, "今日本群消息统计", 10);
    const reply = statsRankReply(data);
    const result = coerceHtmlSegmentsToText(reply);
    const item = Array.isArray(result) ? result[0] : result;
    const text = (item as { data: { text: string } }).data.text;
    expect(text).toContain("今日本群消息统计");
    expect(text).toContain("120");
    expect(text).toContain("Alice");
  });
});
