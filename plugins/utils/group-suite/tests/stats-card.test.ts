import { assertCardImage } from "../../../../tests/helpers/render-card.js";
import { describe, it, expect } from "vitest";
import { buildStatsRankReportData } from "../src/stats-data.js";
import { buildMyStatsHtml, buildStatsRankHtml } from "../src/stats-card.js";

async function assertImage(fragment: string) {
  await assertCardImage(fragment);
}

describe("stats-card", () => {
  it("buildStatsRankHtml 生成排行榜卡片", async () => {
    const stats = new Map([
      ["u1", { name: "Alice", count: 120 }],
      ["u2", { name: "Bob", count: 80 }],
      ["u3", { name: "Carol", count: 45 }],
    ]);
    const data = buildStatsRankReportData(stats, "今日本群消息统计", 10, "u2");
    const html = await buildStatsRankHtml(data);
    expect(html).toContain("今日本群消息统计");
    expect(html).toContain("Alice");
    expect(html).not.toContain("<script");
  });

  it("排行榜卡片可通过 Shotium 渲染", async () => {
    const stats = new Map([
      ["u1", { name: "Alice", count: 120 }],
      ["u2", { name: "Bob", count: 80 }],
    ]);
    const data = buildStatsRankReportData(stats, "本周本群消息统计", 10);
    await assertImage(await buildStatsRankHtml(data));
  });

  it("mystats 卡片可通过 Shotium 渲染", async () => {
    await assertImage(await buildMyStatsHtml({
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
