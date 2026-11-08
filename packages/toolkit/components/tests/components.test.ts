import { jsx, renderToHtml, isJsxElement } from "@zhin.js/jsx";
import {
  Badge,
  Callout,
  Card,
  CardCanvas,
  CardHeader,
  ComparisonBar,
  DonutChart,
  HeatmapGrid,
  KvTable,
  MetricBlock,
  QuoteCard,
  RadarChart,
  Sparkline,
  StatusGrid,
  StepTracker,
  Timeline,
  UsageBar,
} from "../src/index.js";

describe("visual JSX components", () => {
  it("keeps nested display nodes as markup and escapes their text once", async () => {
    const node = jsx(CardCanvas, {
      children: jsx(Card, {
        children: [
          jsx(CardHeader, {
            title: jsx("strong", { children: "<服务>" }),
            subtitle: 0,
            badge: jsx(Badge, { children: jsx("em", { children: "在线" }) }),
          }),
          jsx(KvTable, {
            rows: [
              {
                label: jsx("span", { children: "数量" }),
                value: jsx("b", { children: 12 }),
              },
            ],
          }),
          jsx(MetricBlock, { label: "计数", value: 0 }),
        ],
      }),
    });
    expect(isJsxElement(node)).toBe(true);
    const html = await renderToHtml(node);
    expect(html).toContain("<strong>&lt;服务&gt;</strong>");
    expect(html).toContain("<em>在线</em>");
    expect(html).toContain("<b>12</b>");
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("&amp;lt;");
    expect(html).toMatch(/>0<\/div>/);
  });

  it("preserves a zero-valued metric without a progress sample", async () => {
    const html = await renderToHtml(
      jsx(MetricBlock, { label: "数量", value: 0 })
    );
    expect(html).toMatch(/>0<\/div>/);
  });

  it("composes quotes with nodes rather than coercing them to strings", async () => {
    const html = await renderToHtml(
      jsx(QuoteCard, {
        content: jsx("b", { children: "结论" }),
        author: jsx("em", { children: "QA" }),
        reason: jsx("span", { children: "已验证" }),
      })
    );
    expect(html).toContain("「<b>结论</b>」");
    expect(html).toContain("<em>QA</em> · <span>已验证</span>");
    expect(html).not.toContain("[object Object]");
  });

  it("supports asynchronous children using the shared serializer", async () => {
    const html = await renderToHtml(
      jsx(Card, { children: Promise.resolve(jsx("p", { children: "就绪" })) })
    );
    expect(html).toContain("<p>就绪</p>");
  });

  it("keeps progress and radar coordinates finite for empty or unavailable samples", async () => {
    const html = await renderToHtml([
      jsx(UsageBar, { percent: Number.NaN }),
      jsx(RadarChart, {
        labels: [jsx("b", { children: "A" }), "B", "C"],
        values: [1, 2, 3],
        max: 0,
      }),
      jsx(Sparkline, { values: [] }),
    ]);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).toContain("<polygon");
    expect(html).toContain("<b>A</b>");
    expect(html).toContain('stroke-width="2"');
  });

  it("renders DonutChart, Callout, Timeline, StepTracker, ComparisonBar, StatusGrid and HeatmapGrid", async () => {
    const html = await renderToHtml(
      jsx(CardCanvas, {
        children: jsx(Card, {
          children: [
            jsx(DonutChart, { percent: 75, label: "内存占用" }),
            jsx(Callout, { tone: "warning", title: "告警", message: "负载偏高" }),
            jsx(Timeline, {
              items: [
                { title: "启动", time: "08:00", description: "初始化完成" },
                { title: "就绪", time: "08:01", badge: "OK" },
              ],
            }),
            jsx(StepTracker, {
              current: 1,
              steps: [
                { label: "拉取" },
                { label: "构建", subtitle: "进行中" },
                { label: "发布" },
              ],
            }),
            jsx(ComparisonBar, {
              leftLabel: "蓝方",
              leftValue: 60,
              rightLabel: "红方",
              rightValue: 40,
            }),
            jsx(StatusGrid, {
              items: [
                { label: "Gateway", value: "Online", status: "ok" },
                { label: "Queue", value: "2 pending", status: "warn" },
              ],
            }),
            jsx(HeatmapGrid, { values: [0, 2, 5, 10, 4, 8], columns: 3 }),
          ],
        }),
      })
    );
    expect(html).toContain("75%");
    expect(html).toContain("内存占用");
    expect(html).toContain("负载偏高");
    expect(html).toContain("初始化完成");
    expect(html).toContain("进行中");
    expect(html).toContain("60%");
    expect(html).toContain("Gateway");
    expect(html).not.toContain("NaN");
  });
});
