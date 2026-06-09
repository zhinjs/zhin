import {
  htmlToSvg,
  getAllBuiltinFonts,
  DEFAULT_CARD_THEME,
  CardCanvas,
  Card,
  CardHeader,
  Surface,
  KvTable,
  UsageBar,
  MetricBlock,
  BarChart,
  RadarChart,
  StatChip,
  Row,
  h,
  composeCard,
} from "@zhin.js/satori";

describe("satori html-components (zt-report 对齐)", () => {
  it("DEFAULT_CARD_THEME 与 zt-report 一致", () => {
    expect(DEFAULT_CARD_THEME.canvas).toBe("#d8dce3");
    expect(DEFAULT_CARD_THEME.card).toBe("#ffffff");
    expect(DEFAULT_CARD_THEME.surface).toBe("#f8f9fb");
    expect(DEFAULT_CARD_THEME.accentMem).toBe("#3b82f6");
  });

  it("composeCard 可通过 Satori 渲染", async () => {
    const html = composeCard(
      h(BarChart, { values: [1, 3, 2, 5, 1], peakIndex: 3 }),
    );
    const svg = await htmlToSvg(html, { width: 540, fonts: getAllBuiltinFonts() });
    expect(svg).toContain("<svg");
  });

  it("zt 原语组合可通过 Satori 渲染", async () => {
    const html = composeCard([
      h(CardHeader, { title: "系统状态", subtitle: "Zhin.js test-bot", badge: "host-01" }),
      h(Row, {
        gap: 10,
        style: "margin-bottom:6px",
        children: [
          h(StatChip, { label: "CPU", value: "42%", accent: DEFAULT_CARD_THEME.accentCpu }),
          h(StatChip, { label: "内存", value: "68%", accent: DEFAULT_CARD_THEME.accentMem }),
        ],
      }),
      h(KvTable, { rows: [{ label: "系统", value: "macOS 15" }, { label: "运行", value: "3 天" }] }),
      h(MetricBlock, { label: "占用", percent: 42, accent: DEFAULT_CARD_THEME.accentCpu }),
      h(UsageBar, { percent: 75, accent: DEFAULT_CARD_THEME.accentDisk }),
      h(Surface, { padding: "10px 12px", children: "fallback note" }),
    ].join(""));
    const svg = await htmlToSvg(html, { width: 540, fonts: getAllBuiltinFonts() });
    expect(svg).toContain("<svg");
  });

  it("RadarChart 可通过 Satori 渲染", async () => {
    const html = h(CardCanvas, {
      children: h(Card, {
        children: h(RadarChart, {
          labels: ["活跃", "字数", "参与"],
          values: [80, 60, 90],
        }),
      }),
    });
    const svg = await htmlToSvg(html, { width: 540, fonts: getAllBuiltinFonts() });
    expect(svg).toContain("<svg");
  });
});
