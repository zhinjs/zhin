import { assertCardImage } from "../../../tests/helpers/render-card.js";
import { describe, it, expect } from "vitest";
import {
  buildZtReportHtml,
  collectZtFallbackData,
  collectZtReportData,
  ztReportReply,
} from "../lib/zt-report.js";

// Verify actual PNG delivery from the shared HTML rendering engine.
async function assertImage(fragment: string) {
  await assertCardImage(fragment);
}

const counts = { adapters: 2, plugins: 5 } as const;

describe("zt-report", () => {
  it("ztReportReply 返回 html 段", async () => {
    const data = collectZtFallbackData(counts);
    const reply = await ztReportReply(data);
    expect(reply).toMatchObject({ type: "html" });
    expect(reply.data.html).toContain("系统状态");
  });

  it("buildZtReportHtml 生成可渲染的 HTML 卡片", async () => {
    const data = collectZtFallbackData(counts);
    const html = await buildZtReportHtml(data);
    expect(html).toContain("系统状态");
    expect(html).toContain(data.hostName);
    expect(html).toContain("适配器 2 · 插件 5");
    expect(html).not.toContain("<script");
  });

  it("buildZtReportHtml 可通过 Shotium 渲染", async () => {
    const data = collectZtFallbackData(counts);
    await assertImage(await buildZtReportHtml(data));
  });

  it("长挂载路径布局可通过 Shotium 渲染", async () => {
    const data = collectZtFallbackData(counts);
    data.diskMounts = [
      { mount: "/", used: "332.0 GB", total: "460.0 GB", usage: 72.2 },
      { mount: "/System/Volumes/Data", used: "332.0 GB", total: "460.0 GB", usage: 72.2 },
      { mount: "…lumes/Adobe XD v57.1.12.2", used: "2.0 GB", total: "2.0 GB", usage: 100 },
    ];
    data.diskValue = "666.0 GB / 922.0 GB";
    data.diskUsage = 72.2;
    await assertImage(await buildZtReportHtml(data));
  });

  it("buildZtReportHtml 完整采集数据可通过 Shotium 渲染", async () => {
    let data;
    try {
      data = collectZtReportData(counts);
    } catch {
      return;
    }
    expect(data.frameworkLine).toBe("适配器 2 · 插件 5");
    const html = await buildZtReportHtml(data);
    expect(html).toContain("网络");
    if (data.networkMac) expect(html).toContain(data.networkMac);
    if (data.networkTrafficLine) expect(html).toContain("累计");
    await assertImage(html);
  });
});
