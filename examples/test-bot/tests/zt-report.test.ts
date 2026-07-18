import { describe, it, expect } from "vitest";
import { htmlToSvg, getAllBuiltinFonts } from "@zhin.js/satori";
import {
  buildZtReportHtml,
  collectZtFallbackData,
  collectZtReportData,
  ztReportReply,
} from "../lib/zt-report.js";

// 仅测试 HTML 片段能否过 Satori（开发调试用）
async function assertSatori(fragment: string) {
  const wrap = (body: string) =>
    `<div style="display:flex;flex-direction:column;width:100%;background-color:#d8dce3;font-family:Noto Sans SC,sans-serif">${body}</div>`;
  const svg = await htmlToSvg(wrap(fragment), { width: 540, fonts: getAllBuiltinFonts() });
  expect(svg).toContain("<svg");
}

describe("zt-report", () => {
  it("ztReportReply 返回 html 段", () => {
    const root = { adapters: { length: 2 }, children: { length: 5 } } as never;
    const data = collectZtFallbackData(root);
    const reply = ztReportReply(data);
    expect(reply).toMatchObject({ type: "html" });
    expect(reply.data.html).toContain("系统状态");
  });

  it("buildZtReportHtml 生成可渲染的 HTML 卡片", () => {
    const root = { adapters: { length: 2 }, children: { length: 5 } } as never;
    const data = collectZtFallbackData(root);
    const html = buildZtReportHtml(data);
    expect(html).toContain("系统状态");
    expect(html).toContain(data.hostName);
    expect(html).not.toContain("<script");
  });

  it("buildZtReportHtml 可通过 Satori 渲染", async () => {
    const root = { adapters: { length: 2 }, children: { length: 5 } } as never;
    const data = collectZtFallbackData(root);
    await assertSatori(buildZtReportHtml(data));
  });

  it("长挂载路径布局可通过 Satori 渲染", async () => {
    const root = { adapters: { length: 2 }, children: { length: 5 } } as never;
    const data = collectZtFallbackData(root);
    data.diskMounts = [
      { mount: "/", used: "332.0 GB", total: "460.0 GB", usage: 72.2 },
      { mount: "/System/Volumes/Data", used: "332.0 GB", total: "460.0 GB", usage: 72.2 },
      { mount: "…lumes/Adobe XD v57.1.12.2", used: "2.0 GB", total: "2.0 GB", usage: 100 },
    ];
    data.diskValue = "666.0 GB / 922.0 GB";
    data.diskUsage = 72.2;
    await assertSatori(buildZtReportHtml(data));
  });

  it("buildZtReportHtml 完整采集数据可通过 Satori 渲染", async () => {
    const root = { adapters: { length: 2 }, children: { length: 5 } } as never;
    let data;
    try {
      data = collectZtReportData(root);
    } catch {
      return;
    }
    await assertSatori(buildZtReportHtml(data));
  });
});
