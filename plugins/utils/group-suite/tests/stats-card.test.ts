import { describe, it, expect } from "vitest";
import { htmlToSvg, getAllBuiltinFonts } from "../../../../packages/toolkit/satori/src/index.ts";
import { buildStatsRankReportData } from "../src/stats-data.js";
import { buildMyStatsHtml, buildStatsRankHtml } from "../src/stats-card.js";
import { wrapCardHtml } from "@zhin.js/satori";

async function assertSatori(fragment: string) {
  const svg = await htmlToSvg(wrapCardHtml(fragment, "#d8dce3"), { width: 540, fonts: getAllBuiltinFonts() });
  expect(svg).toContain("<svg");
}

describe("stats-card", () => {
  it("buildStatsRankHtml 生成排行榜卡片", () => {
    const stats = new Map([
      ["u1", { name: "Alice", count: 120 }],
      ["u2", { name: "Bob", count: 80 }],
      ["u3", { name: "Carol", count: 45 }],
    ]);
    const data = buildStatsRankReportData(stats, "今日本群消息统计", 10, "u2");
    const html = buildStatsRankHtml(data);
    expect(html).toContain("今日本群消息统计");
    expect(html).toContain("Alice");
    expect(html).not.toContain("<script");
  });

  it("排行榜卡片可通过 Satori 渲染", async () => {
    const stats = new Map([
      ["u1", { name: "Alice", count: 120 }],
      ["u2", { name: "Bob", count: 80 }],
    ]);
    const data = buildStatsRankReportData(stats, "本周本群消息统计", 10);
    await assertSatori(buildStatsRankHtml(data));
  });

  it("mystats 卡片可通过 Satori 渲染", async () => {
    await assertSatori(buildMyStatsHtml({
      userName: "测试用户",
      scope: "本群",
      todayCount: 12,
      weekCount: 56,
      monthCount: 210,
      totalCount: 890,
      activeDays: 18,
    }));
  });
});
