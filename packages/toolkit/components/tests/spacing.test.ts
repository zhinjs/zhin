import { jsx, renderToHtml, type JSXStyle } from "@zhin.js/jsx";
import { htmlToSvg, getAllBuiltinFonts } from "../../satori/src/index.js";
import {
  BarChart,
  Card,
  CardCanvas,
  CardHeader,
  Col,
  DEFAULT_THEME,
  KvTable,
  Divider,
  DualSection,
  MetricBlock,
  ProfileRow,
  QuoteCard,
  Section,
  StatChip,
  ThemeProvider,
  TopicItem,
  UsageBar,
  EmptyState,
  Surface,
  type ComponentCustomization,
} from "../src/index.js";

const rows = [
  { label: "A", value: "1" },
  { label: "B", value: "2" },
];
const svgHeight = (svg: string) =>
  Number(svg.match(/<svg[^>]*\bheight="([\d.]+)"/)?.[1]);

describe("component spacing", () => {
  it("uses the shared four-pixel spacing steps in default component CSS", async () => {
    expect(DEFAULT_THEME.spacing).toMatchObject({
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
      rowGap: 0,
    });
    const html = await renderToHtml(
      jsx(CardCanvas, {
        children: jsx(Card, {
          children: [
            jsx(CardHeader, { title: "标题", subtitle: "说明", badge: "在线" }),
            jsx(KvTable, { rows }),
            jsx(Divider, {}),
            jsx(DualSection, {
              left: { title: "左", rows },
              right: { title: "右", rows },
            }),
            jsx(MetricBlock, { label: "数量", value: 0, percent: 50 }),
            jsx(Section, { title: "分区", children: jsx(UsageBar, {}) }),
            jsx(StatChip, { label: "数值", value: 1 }),
            jsx(TopicItem, { index: 1, title: "主题", summary: "摘要" }),
            jsx(ProfileRow, { index: 1, name: "成员", reason: "参与" }),
            jsx(QuoteCard, {
              index: 1,
              content: "结论",
              author: "QA",
              reason: "通过",
            }),
            jsx(BarChart, {
              values: [1, 2, 3],
              peakIndex: 2,
              showPeakValue: true,
            }),
          ],
        }),
      })
    );
    const spacing = [
      ...html.matchAll(
        /(?:padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap): ([^;"]+)/g
      ),
    ];
    expect(spacing.length).toBeGreaterThan(15);
    for (const [, declaration] of spacing) {
      for (const [, value] of declaration.matchAll(/(-?[\d.]+)px/g))
        expect(Number(value) % 4).toBe(0);
    }
    for (const [, declaration] of html.matchAll(
      /(?:padding|margin): ([^;"]+)/g
    )) {
      const sides = declaration.trim().split(/\s+/);
      expect([1, 2]).toContain(sides.length);
    }
    expect(html).not.toMatch(/(?:padding|margin)-(?:top|right|bottom|left):/);
    expect(html).toContain("margin: 16px 0"); // Divider has explicit symmetric spacing.
    expect(html).not.toContain("gap: 2px");
    expect(html).not.toContain("gap: 3px");
    expect(html).not.toContain("gap: 6px");
  });

  it("uses symmetric row margins without a second vertical container gap", async () => {
    const html = await renderToHtml(
      jsx(Col, { children: jsx(KvTable, { rows }) })
    );
    expect(html).toContain("gap: 0px");
    expect(html.match(/margin: 4px 0/g)).toHaveLength(2);
    expect(KvTable({ rows }).props.style).not.toHaveProperty("gap");
    expect(html).not.toContain("margin-bottom:");
    const svg = await htmlToSvg(html, {
      width: 200,
      fonts: getAllBuiltinFonts(),
    });
    // Two 16px lines + two symmetric 4px margins per row; no vertical gap.
    expect(svgHeight(svg)).toBe(48);
  });

  it("applies a shared spacing override and scale once in real SVG layout", async () => {
    const heights: number[] = [];
    for (const spacing of [{ xs: 8 }, { scale: 2 }]) {
      const html = await renderToHtml(
        jsx(ThemeProvider, {
          theme: { spacing },
          children: jsx(KvTable, { rows }),
        })
      );
      const svg = await htmlToSvg(html, {
        width: 200,
        fonts: getAllBuiltinFonts(),
      });
      heights.push(svgHeight(svg));
    }
    expect(heights).toEqual([64, 64]);
  });

  it("keeps container padding separate from the symmetric element margins", async () => {
    const html = await renderToHtml(
      jsx(ThemeProvider, {
        theme: { spacing: { sm: 12, lg: 20, xl: 28 } },
        children: jsx(CardCanvas, {
          children: jsx(Card, {
            children: jsx(Section, { title: "分区", children: "正文" }),
          }),
        }),
      })
    );
    expect(html).toContain("padding: 20px");
    expect(html).toContain("padding: 28px");
    expect(html).toContain("padding: 20px 0");
    expect(html).toContain("margin: 12px 0");
    expect(html).not.toContain("gap: 12px");
  });
});

/** Unique root fills let us measure actual visible boxes, excluding masks/text. */
const rootStyle = (background: string): JSXStyle => ({
  background,
  border: 0,
  borderRadius: 0,
  boxShadow: false,
});
const svgBox = (svg: string, fill: string) => {
  const rectangle = [...svg.matchAll(/<rect\b[^>]*>/g)].find(([tag]) =>
    tag.includes(`fill="${fill}"`)
  )?.[0];
  if (!rectangle) throw new Error(`Missing rendered root ${fill}`);
  return {
    top: Number(rectangle.match(/\by="([\d.]+)"/)?.[1]),
    height: Number(rectangle.match(/\bheight="([\d.]+)"/)?.[1]),
  };
};
const quote = (custom: ComponentCustomization) =>
  jsx(QuoteCard, { content: "A", author: "QA", custom });
const empty = (custom: ComponentCustomization) =>
  jsx(EmptyState, { message: "B", custom });
const topic = (custom: ComponentCustomization) =>
  jsx(TopicItem, { index: 1, title: "Topic", custom });
const profile = (custom: ComponentCustomization) =>
  jsx(ProfileRow, { name: "User", custom });

describe("standalone semantic block spacing", () => {
  it.each([
    ["quote/empty", quote, empty],
    ["quote/quote", quote, quote],
    ["empty/empty", empty, empty],
    ["topic/topic", topic, topic],
    ["profile/profile", profile, profile],
    ["topic/profile", topic, profile],
  ] as const)(
    "separates %s roots by 8px in actual SVG layout",
    async (_, first, second) => {
      const html = await renderToHtml(
        jsx(Col, {
          children: [
            first({ style: rootStyle("#112233") }),
            second({ style: rootStyle("#445566") }),
          ],
        })
      );
      const svg = await htmlToSvg(html, {
        width: 200,
        fonts: getAllBuiltinFonts(),
      });
      const a = svgBox(svg, "#112233"),
        b = svgBox(svg, "#445566");
      expect(b.top - (a.top + a.height)).toBe(8);
      expect(html.match(/margin: 4px 0/g)).toHaveLength(2);
      expect(svg).not.toContain("NaN");
    }
  );

  it.each([
    [{ spacing: { xs: 8 } }, undefined, 16],
    [{ spacing: { scale: 2 } }, undefined, 16],
    [
      {
        components: {
          QuoteCard: { margin: "12px 0" },
          EmptyState: { margin: "12px 0" },
        },
      },
      undefined,
      24,
    ],
    [{ spacing: { scale: 2 } }, "12px 0", 24],
    [
      {
        components: {
          QuoteCard: { margin: "12px 0" },
          EmptyState: { margin: "12px 0" },
        },
      },
      0,
      0,
    ],
  ] as const)(
    "honors theme spacing, scaling and local margin overrides (%#)",
    async (theme, margin, expectedGap) => {
      const customize = (fill: string): ComponentCustomization => ({
        style: {
          ...(rootStyle(fill) as object),
          ...(margin === undefined ? {} : { margin }),
        },
      });
      const html = await renderToHtml(
        jsx(ThemeProvider, {
          theme,
          children: jsx(Col, {
            children: [
              quote(customize("#112233")),
              empty(customize("#445566")),
            ],
          }),
        })
      );
      const svg = await htmlToSvg(html, {
        width: 200,
        fonts: getAllBuiltinFonts(),
      });
      const a = svgBox(svg, "#112233"),
        b = svgBox(svg, "#445566");
      expect(b.top - (a.top + a.height)).toBe(expectedGap);
    }
  );

  it("keeps primitive Surface and nested header/statistic surfaces free of outer margin", async () => {
    const html = await renderToHtml([
      jsx(Surface, { children: "Primitive" }),
      jsx(CardHeader, { title: "Header", badge: "Nested surface" }),
      jsx(StatChip, { label: "Count", value: 1 }),
    ]);
    expect(html.match(/margin: /g)).toHaveLength(1);
    expect(html).toContain("margin: 8px 0"); // Only CardHeader owns this boundary.
    expect(html).not.toContain("margin: 4px 0");
  });
});
