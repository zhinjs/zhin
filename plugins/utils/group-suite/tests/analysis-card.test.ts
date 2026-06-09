import { describe, it, expect } from "vitest";
import { htmlToSvg, getAllBuiltinFonts } from "../../../../packages/toolkit/satori/src/index.ts";
import {
  buildAnalysisReportData,
  computeBasicStats,
  type InboxMessageRow,
} from "../src/analysis.js";
import { buildAnalysisReportHtml } from "../src/analysis-card.js";
import { wrapCardHtml } from "@zhin.js/satori";

async function assertSatori(fragment: string) {
  const svg = await htmlToSvg(wrapCardHtml(fragment, "#d8dce3"), { width: 540, fonts: getAllBuiltinFonts() });
  expect(svg).toContain("<svg");
}

function sampleRows(): InboxMessageRow[] {
  const base = Date.now() - 3 * 60 * 60 * 1000;
  return [
    { adapter: "icqq", bot_id: "1", channel_id: "g1", channel_type: "group", sender_id: "u1", sender_name: "Alice", content: '[{"type":"text","data":{"text":"你好"}}]', raw: "", created_at: base },
    { adapter: "icqq", bot_id: "1", channel_id: "g1", channel_type: "group", sender_id: "u2", sender_name: "Bob", content: '[{"type":"text","data":{"text":"今天天气不错"}}]', raw: "", created_at: base + 3600_000 },
    { adapter: "icqq", bot_id: "1", channel_id: "g1", channel_type: "group", sender_id: "u1", sender_name: "Alice", content: '[{"type":"text","data":{"text":"周末去哪玩"}}]', raw: "", created_at: base + 7200_000 },
    { adapter: "icqq", bot_id: "1", channel_id: "g1", channel_type: "group", sender_id: "u3", sender_name: "Carol", content: '[{"type":"text","data":{"text":"推荐去爬山"}}]', raw: "", created_at: base + 10_800_000 },
  ];
}

describe("analysis-card", () => {
  it("buildAnalysisReportHtml 生成群分析卡片 HTML", () => {
    const stats = computeBasicStats(sampleRows());
    const data = buildAnalysisReportData(stats, {
      channelName: "测试群",
      days: 1,
      startDate: "2026-06-08",
      endDate: "2026-06-09",
    });
    const html = buildAnalysisReportHtml(data);
    expect(html).toContain("群日常分析");
    expect(html).toContain("测试群");
    expect(html).not.toContain("<script");
  });

  it("含 LLM 区块的卡片可通过 Satori 渲染", async () => {
    const stats = computeBasicStats(sampleRows());
    const data = buildAnalysisReportData(
      stats,
      { channelName: "测试群", days: 1, startDate: "2026-06-08", endDate: "2026-06-09" },
      {
        topics: [{ topic: "周末活动", summary: "讨论出游计划" }],
        quotes: [{ content: "推荐去爬山", sender: "Carol", reason: "实用建议" }],
        userTitles: [{ name: "Alice", user_id: "u1", title: "话题发起者", reason: "积极发言" }],
      },
    );
    await assertSatori(buildAnalysisReportHtml(data));
  });
});
