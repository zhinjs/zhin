import { jsx, renderToHtml } from "@zhin.js/jsx";
import { htmlToSvg, getAllBuiltinFonts } from "../../satori/src/index.js";
import {
  Badge,
  Row,
  Table,
  TableCell,
  TableRow,
  ThemeProvider,
} from "../src/index.js";

const renderSvg = async (
  node: Parameters<typeof renderToHtml>[0],
  width = 240
) =>
  htmlToSvg(await renderToHtml(node), { width, fonts: getAllBuiltinFonts() });
const box = (svg: string, fill: string) => {
  const rect = [...svg.matchAll(/<rect\b[^>]*>/g)].find(([tag]) =>
    tag.includes(`fill="${fill}"`)
  )?.[0];
  if (!rect) throw new Error(`No cell rendered with ${fill}`);
  const attribute = (name: string) =>
    Number(rect.match(new RegExp(`\\b${name}="([\\d.]+)"`))?.[1]);
  return {
    x: attribute("x"),
    y: attribute("y"),
    width: attribute("width"),
    height: attribute("height"),
  };
};

describe("composable tables", () => {
  it("renders optional caption/headers and node-valued data without coercion", async () => {
    const html = await renderToHtml(
      jsx(Table, {
        caption: jsx("strong", { children: "<巡检>" }),
        headers: ["名称", jsx("em", { children: "状态" })],
        rows: [
          [0, jsx(Badge, { children: "在线" })],
          [Promise.resolve(jsx("b", { children: "异步" })), "等待"],
        ],
      })
    );
    expect(html).toContain("<strong>&lt;巡检&gt;</strong>");
    expect(html).toContain("<em>状态</em>");
    expect(html).toContain("<b>异步</b>");
    expect(html).toMatch(/>0<\/div>/);
    expect(html.match(/role="columnheader"/g)).toHaveLength(2);
    expect(html.match(/role="cell"/g)).toHaveLength(4);
    expect(html.match(/role="row"/g)).toHaveLength(3);
    expect(html).toContain('role="table"');
    expect(html).not.toContain("[object Object]");
  });

  it("supports a headerless data table with no duplicate first-row border", async () => {
    const html = await renderToHtml(
      jsx(Table, {
        rows: [
          ["A", 1],
          ["B", 2],
        ],
      })
    );
    expect(html).not.toContain('role="columnheader"');
    expect(html.match(/border-top: 0/g)).toHaveLength(1);
    expect(html.match(/border-top: 1px solid/g)).toHaveLength(1);
    expect(
      await renderSvg(
        jsx(Table, {
          rows: [
            ["A", 1],
            ["B", 2],
          ],
        })
      )
    ).not.toContain("NaN");
  });

  it("lays out fixed and flexible cells as adjacent SVG boxes with no extra margin/gap", async () => {
    const svg = await renderSvg(
      jsx(Table, {
        custom: { style: { border: 0, borderRadius: 0 } },
        children: jsx(TableRow, {
          separator: false,
          children: [
            jsx(TableCell, {
              width: 80,
              custom: { style: { background: "#112233" } },
              children: "A",
            }),
            jsx(TableCell, {
              align: "right",
              custom: { style: { background: "#445566" } },
              children: "B",
            }),
          ],
        }),
      })
    );
    const a = box(svg, "#112233"),
      b = box(svg, "#445566");
    expect(a.width).toBe(80);
    expect(b.width).toBe(160);
    expect(b.x).toBe(a.x + a.width);
    expect(a.y).toBe(b.y);
    expect(a.height).toBe(32);
    expect(b.height).toBe(32);
  });

  it("keeps nested JSX layouts and explicit alignment/width customizable", async () => {
    const node = jsx(Table, {
      children: jsx(TableRow, {
        separator: false,
        children: [
          jsx(TableCell, {
            width: "40%",
            children: jsx("strong", { children: "名称" }),
          }),
          jsx(TableCell, {
            align: "center",
            children: jsx(Row, {
              gap: 8,
              children: [
                jsx("span", { children: "服务" }),
                jsx(Badge, { children: "在线" }),
              ],
            }),
          }),
        ],
      }),
    });
    const html = await renderToHtml(node);
    expect(html).toContain("width: 40%");
    expect(html).toContain("text-align: center");
    expect(html).toContain("<strong>名称</strong>");
    const svg = await renderSvg(node);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
  });

  it("themes the whole table and preserves caption JSX overrides", async () => {
    const html = await renderToHtml(
      jsx(ThemeProvider, {
        theme: {
          palette: { card: "ivory", surface: "lavender", text: "navy" },
          radii: { surface: 20 },
          components: {
            Table: { borderColor: "purple" },
            TableCell: { fontSize: 15 },
          },
        },
        children: jsx(Table, {
          caption: "旧标题",
          custom: {
            style: { borderRadius: 0 },
            text: { caption: jsx("b", { children: "新标题" }) },
          },
          headers: ["Name"],
          rows: [["A"]],
        }),
      })
    );
    expect(html).toContain("background: ivory");
    expect(html).toContain("background: lavender");
    expect(html).toContain("color: navy");
    expect(html).toContain("border-color: purple");
    expect(html).toContain("border-radius: 0");
    expect(html).toContain("font-size: 15px");
    expect(html).toContain("<b>新标题</b>");
    expect(html).not.toContain("旧标题");
  });

  it("scales cell padding once and gives local padding the final say in SVG", async () => {
    const heights: number[] = [];
    for (const local of [false, true]) {
      const svg = await renderSvg(
        jsx(ThemeProvider, {
          theme: { spacing: { scale: 2 } },
          children: jsx(Table, {
            children: jsx(TableRow, {
              separator: false,
              children: jsx(TableCell, {
                custom: {
                  style: {
                    background: "#112233",
                    ...(local ? { padding: 0 } : {}),
                  },
                },
                children: "A",
              }),
            }),
          }),
        })
      );
      heights.push(box(svg, "#112233").height);
    }
    expect(heights).toEqual([48, 16]);
  });
});
