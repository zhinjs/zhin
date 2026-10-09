import { jsx, renderToHtml, type JSXElement, type JSXNode } from "@zhin.js/jsx";
import {
  Badge,
  BarChart,
  BarRow,
  Card,
  CardCanvas,
  CardHeader,
  EmptyState,
  QuoteCard,
  RadarChart,
  Section,
  ThemeProvider,
  UsageBar,
} from "../src/index.js";

const withTheme = (
  theme: Parameters<typeof ThemeProvider>[0]["theme"],
  children: JSXNode
) => jsx(ThemeProvider, { theme, children });

describe("component theme scopes", () => {
  it("inherits tokens and CSS keys through nested providers", async () => {
    const html = await renderToHtml(
      withTheme(
        {
          palette: { text: "#123456", accentSwap: "#111111" },
          typography: { fontFamily: "Inter", sizes: { title: 31 } },
          style: { letterSpacing: "1px", opacity: 0.8 },
          components: { Badge: { padding: "2px", border: "1px solid red" } },
        },
        withTheme(
          {
            palette: { accentSwap: "#654321" },
            style: { opacity: 0.4 },
            components: { Badge: { padding: "4px" } },
          },
          [
            jsx(CardHeader, { title: "标题" }),
            jsx(Badge, { children: "已继承" }),
          ]
        )
      )
    );
    expect(html).toContain("font-family: Inter");
    expect(html).toContain("font-size: 31px");
    expect(html).toContain("color: #123456");
    expect(html).toContain("color: #654321");
    expect(html).toContain("letter-spacing: 1px");
    expect(html).toContain("opacity: 0.4");
    expect(html).toContain("padding: 4px");
    expect(html).toContain("border: 1px solid red");
    expect(html).not.toContain("padding: 2px");
  });

  it("keeps parallel themes independent when the same lazy tree is reused", async () => {
    const shared = jsx(CardHeader, {
      title: "共享树",
      badge: jsx(Badge, { children: "在线" }),
    });
    const [red, blue] = await Promise.all([
      renderToHtml(
        withTheme({ palette: { text: "red", accentSwap: "salmon" } }, shared)
      ),
      renderToHtml(
        withTheme({ palette: { text: "blue", accentSwap: "skyblue" } }, shared)
      ),
    ]);
    expect(red).toContain("color: red");
    expect(red).toContain("color: salmon");
    expect(red).not.toContain("skyblue");
    expect(blue).toContain("color: blue");
    expect(blue).toContain("color: skyblue");
    expect(blue).not.toContain("salmon");
    expect(await renderToHtml(shared)).toContain("color: #111111");
  });

  it("themes children produced by async user components and evaluates each once", async () => {
    const asynchronous = vi.fn(async () => {
      await Promise.resolve();
      return jsx(CardHeader, {
        title: "异步标题",
        badge: jsx(Badge, { children: Promise.resolve("异步徽标") }),
      });
    });
    const synchronous = vi.fn(() =>
      jsx(Section, { title: "分区", children: jsx(asynchronous, {}) })
    );
    const html = await renderToHtml(
      withTheme(
        {
          palette: { text: "#abcdef", accentSwap: "#fedcba" },
          typography: { sizes: { title: 29 } },
        },
        jsx(synchronous, {})
      )
    );
    expect(html).toContain("color: #abcdef");
    expect(html).toContain("color: #fedcba");
    expect(html).toContain("font-size: 29px");
    expect(html).toContain("异步徽标");
    expect(asynchronous).toHaveBeenCalledTimes(1);
    expect(synchronous).toHaveBeenCalledTimes(1);
  });

  it("retains a nested theme after an async component returns a provider", async () => {
    const child = async (): Promise<JSXElement> =>
      withTheme(
        { palette: { text: "purple" } },
        jsx(CardHeader, { title: "内层" })
      );
    const html = await renderToHtml(
      withTheme(
        { palette: { text: "orange" }, typography: { sizes: { title: 28 } } },
        jsx(child, {})
      )
    );
    expect(html).toContain("color: purple");
    expect(html).not.toContain("color: orange");
    expect(html).toContain("font-size: 28px");
  });

  it("applies global defaults, component styles and local root overrides in order", async () => {
    const html = await renderToHtml(
      withTheme(
        {
          palette: { card: "linear-gradient(135deg, #fff, #eef)" },
          border: { width: 2, style: "dashed" },
          radii: { card: 24 },
          spacing: { cardPadding: "30px" },
          style: { background: "pink", marginTop: 9 },
          components: { Card: { background: "gold", borderRadius: 32 } },
        },
        jsx(Card, {
          custom: {
            style: {
              background: "linear-gradient(90deg, red, blue)",
              "border-radius": 0,
              padding: 0,
              boxShadow: "none",
            },
          },
          children: "局部",
        })
      )
    );
    expect(html).toContain("background: linear-gradient(90deg, red, blue)");
    expect(html).toContain("box-sizing: border-box");
    expect(html).toContain("border-radius: 0");
    expect(html).toContain("padding: 0");
    expect(html).toContain("box-shadow: none");
    expect(html).toContain("margin-top: 9px");
    expect(html).toContain("border: 2px dashed");
    expect(html).not.toContain("background: gold");
    expect(html).not.toContain("background: pink");
    expect(html).not.toMatch(/\s(?:custom|theme|palette)=/);
  });

  it("applies a composite component override to its delegated visual root", async () => {
    const html = await renderToHtml(
      withTheme(
        { components: { EmptyState: { borderRadius: 27 } } },
        jsx(EmptyState, {
          custom: {
            style: { padding: 0, background: "beige" },
            text: { message: jsx("b", { children: "没有数据" }) },
          },
        })
      )
    );
    expect(html).toContain("background: beige");
    expect(html).toContain("border-radius: 27px");
    expect(html).toContain("padding: 0");
    expect(html).toContain("<b>没有数据</b>");
  });

  it("preserves node-valued default text, zero overrides and escaping", async () => {
    const html = await renderToHtml(
      withTheme(
        {
          text: {
            unavailable: jsx("b", { children: "<未采样>" }),
            emptyState: jsx("i", { children: "等待" }),
            rankSeparator: jsx("span", { children: "：" }),
            quoteOpen: "[",
            quoteClose: "]",
            reasonSeparator: jsx("em", { children: " / " }),
            indexPrefix: "编号 ",
          },
        },
        [
          jsx(UsageBar, {}),
          jsx(EmptyState, {}),
          jsx(BarRow, {
            rank: 1,
            label: jsx("b", { children: "用户" }),
            value: 2,
            percent: 50,
          }),
          jsx(QuoteCard, {
            index: 1,
            content: jsx("b", { children: "内容" }),
            author: "QA",
            reason: "通过",
          }),
          jsx(CardHeader, {
            title: "旧标题",
            custom: {
              text: { title: 0, badge: jsx(Badge, { children: "<安全>" }) },
            },
          }),
        ]
      )
    );
    expect(html).toContain("<b>&lt;未采样&gt;</b>");
    expect(html).toContain("<i>等待</i>");
    expect(html).toContain("1<span>：</span><b>用户</b>");
    expect(html).toContain("[<b>内容</b>]");
    expect(html).toContain("QA<em> / </em>通过");
    expect(html).toContain("编号 1");
    expect(html).toContain("&lt;安全&gt;");
    expect(html).not.toContain("旧标题");
    expect(html).toMatch(/>0<\/div>/);
    expect(html).not.toContain("[object Object]");
  });

  it("allows null and zero local text overrides instead of falling back", async () => {
    const html = await renderToHtml([
      jsx(Badge, { children: "fallback", custom: { text: { text: null } } }),
      jsx(Badge, { children: "fallback", custom: { text: { text: 0 } } }),
      jsx(UsageBar, { percent: 42, custom: { text: { label: null } } }),
    ]);
    expect(html).not.toContain("fallback");
    expect(html).not.toContain("42.0%");
    expect(html).toMatch(/>0<\/div>/);
  });

  it("themes canvas gradients and chart labels, accents and SVG strokes", async () => {
    const html = await renderToHtml(
      withTheme(
        {
          palette: {
            canvas: "linear-gradient(90deg, #eee, #fff)",
            accentMem: "teal",
            textMuted: "navy",
            divider: "silver",
          },
          typography: { sizes: { tiny: 14 } },
          text: { chartTicks: [jsx("b", { children: "早" }), "中", "晚"] },
        },
        jsx(CardCanvas, {
          children: [
            jsx(BarChart, { values: [1, 2, 3] }),
            jsx(RadarChart, { labels: ["A", "B", "C"], values: [1, 2, 3] }),
          ],
        })
      )
    );
    expect(html).toContain("background: linear-gradient(90deg, #eee, #fff)");
    expect(html).toContain("background: teal");
    expect(html).toContain("color: navy");
    expect(html).toContain("font-size: 14px");
    expect(html).toContain('stroke="silver"');
    expect(html).toContain("<b>早</b>");
  });

  it("scales component spacing while preserving explicit local values", async () => {
    const html = await renderToHtml(
      withTheme(
        { spacing: { scale: 2, cardPadding: "10px", sectionGap: 7 } },
        jsx(Card, {
          custom: { style: { marginTop: 3 } },
          children: jsx(Section, { title: "间距", children: "内容" }),
        })
      )
    );
    expect(html).toContain("padding: 20px");
    expect(html).toContain("margin: 14px 0");
    expect(html).not.toContain("gap: 14px");
    expect(html).toContain("margin-top: 3px");
    await expect(
      renderToHtml(withTheme({ spacing: { scale: -1 } }, "无效"))
    ).rejects.toThrow("finite and non-negative");
  });

  it("rejects circular trees and self-resolving thenables without hanging", async () => {
    const cycle: JSXNode[] = [];
    cycle.push(cycle);
    await expect(renderToHtml(withTheme({}, cycle))).rejects.toThrow(
      "Circular"
    );
    const thenable = {
      then(resolve: (node: JSXNode) => void) {
        resolve(thenable as unknown as JSXNode);
      },
    };
    await expect(
      renderToHtml(withTheme({}, thenable as unknown as JSXNode))
    ).rejects.toThrow("Circular");
    const loop = (): JSXNode => jsx(loop, {});
    await expect(
      renderToHtml(withTheme({}, jsx(loop, {})), { maxDepth: 20 })
    ).rejects.toThrow(/depth/);
  });
});
