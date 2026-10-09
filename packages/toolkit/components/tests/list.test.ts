import { Fragment, jsx, renderToHtml, type JSXRenderable } from "@zhin.js/jsx";
import { List, ListItem } from "../src/list.js";
import { ThemeProvider } from "../src/theme.js";
import { Badge } from "../src/display.js";
import { Checkbox } from "../src/controls.js";
import { htmlToSvg, getAllBuiltinFonts } from "../../satori/src/index.js";

const height = (svg: string) =>
  Number(svg.match(/<svg[^>]*height="([\d.]+)"/)?.[1]);
const svg = async (node: JSXRenderable) =>
  htmlToSvg(await renderToHtml(node), {
    width: 240,
    fonts: getAllBuiltinFonts(),
  });

describe("display lists", () => {
  it("preserves rich/async item content, zero and escaping", async () => {
    const html = await renderToHtml(
      jsx(List, {
        items: [
          jsx("strong", { children: "<服务>" }),
          0,
          Promise.resolve(jsx(Badge, { children: "异步" })),
        ],
      })
    );
    expect(html).toContain("<strong>&lt;服务&gt;</strong>");
    expect(html).toContain("异步");
    expect(html).toMatch(/>0<\/div>/);
    expect(html.match(/role="listitem"/g)).toHaveLength(3);
    expect(html.match(/>•<\/div>/g)).toHaveLength(3);
    expect(html).not.toContain("[object Object]");
  });

  it("numbers data and direct/fragment items under ThemeProvider without evaluating unknown children", async () => {
    const unknown = vi.fn(async () => jsx("span", { children: "说明" }));
    const node = jsx(ThemeProvider, {
      theme: { palette: { accentMem: "purple" } },
      children: jsx(List, {
        ordered: true,
        start: 3,
        items: ["A"],
        children: [
          jsx(unknown, {}),
          jsx(ListItem, { children: "B" }),
          jsx(Fragment, {
            children: [false, jsx(ListItem, { children: "C" })],
          }),
        ],
      }),
    });
    const html = await renderToHtml(node);
    expect(html).toContain(">3. </div>");
    expect(html).toContain(">4. </div>");
    expect(html).toContain(">5. </div>");
    expect(html).not.toContain(">6. </div>");
    expect(html).toContain("color: purple");
    expect(unknown).toHaveBeenCalledTimes(1);
    expect(html).not.toMatch(/(?:inheritedMarker|list-marker)=/);
  });

  it("supports zero/negative starts, explicit marker nodes and hidden task markers", async () => {
    const html = await renderToHtml([
      jsx(List, { ordered: true, start: 0, items: ["零"] }),
      jsx(List, { ordered: true, start: -1, items: ["负"] }),
      jsx(List, {
        children: [
          jsx(ListItem, {
            marker: jsx(Checkbox, {
              checked: true,
              custom: { style: { margin: 0 } },
            }),
            children: "任务",
          }),
          jsx(ListItem, { marker: false, children: "无标记" }),
          jsx(ListItem, {
            custom: { text: { marker: 0 } },
            children: "数字标记",
          }),
        ],
      }),
    ]);
    expect(html).toContain(">0. </div>");
    expect(html).toContain(">-1. </div>");
    expect(html).toContain("<svg");
    expect(html).not.toContain(">•</div>");
    expect(html).toMatch(/>0<\/div>/);
    await expect(
      renderToHtml(jsx(List, { ordered: true, start: Number.NaN }))
    ).rejects.toThrow("finite integer");
  });

  it("lays out repeated items without an extra wrapper margin or vertical gap", async () => {
    expect(height(await svg(jsx(List, { items: ["A", "B"] })))).toBe(48);
    expect(
      height(
        await svg(
          jsx(ThemeProvider, {
            theme: { spacing: { scale: 2 } },
            children: jsx(List, { ordered: true, start: 3, items: ["A", "B"] }),
          })
        )
      )
    ).toBe(64);
    const html = await renderToHtml(jsx(List, { items: ["A", "B"] }));
    expect(html).toContain("margin: 0");
    expect(html.match(/margin: 4px 0/g)).toHaveLength(2);
    expect(List({ items: ["A", "B"] }).props.style).not.toHaveProperty("gap");
  });

  it("renders nested ordered lists with increasing visual indentation", async () => {
    const node = jsx(List, {
      ordered: true,
      children: jsx(ListItem, {
        custom: { style: { background: "#112233" } },
        children: [
          "Parent",
          jsx(List, {
            ordered: true,
            start: 2,
            children: jsx(ListItem, {
              custom: { style: { background: "#445566" } },
              children: "Child",
            }),
          }),
        ],
      }),
    });
    const html = await renderToHtml(node);
    expect(html).toContain(">1. </div>");
    expect(html).toContain(">2. </div>");
    const rendered = await svg(node);
    const root = [
      ...rendered.matchAll(/<rect[^>]*fill="#112233"[^>]*>/g),
    ][0]?.[0];
    const nested = [
      ...rendered.matchAll(/<rect[^>]*fill="#445566"[^>]*>/g),
    ][0]?.[0];
    expect(root).toBeDefined();
    expect(nested).toBeDefined();
    const x = (tag: string) => Number(tag.match(/\bx="([\d.]+)"/)?.[1]);
    expect(x(nested!) - x(root!)).toBe(24); // Marker min-width 16 + inner row gap 8.
    expect(rendered).not.toContain("NaN");
  });

  it("themes default marker nodes and lets local marker/margin overrides win", async () => {
    const html = await renderToHtml(
      jsx(ThemeProvider, {
        theme: {
          text: { listMarker: jsx("b", { children: "→" }) },
          components: { ListItem: { margin: "12px 0" } },
        },
        children: jsx(List, {
          children: [
            jsx(ListItem, { children: "A" }),
            jsx(ListItem, {
              marker: null,
              custom: { style: { margin: 0 } },
              children: "B",
            }),
          ],
        }),
      })
    );
    expect(html.match(/<b>→<\/b>/g)).toHaveLength(1);
    expect(html).toContain("margin: 12px 0");
    expect(html).toContain("margin: 0");
  });

  it("rejects circular composed arrays without recursion overflow", async () => {
    const loop: JSXRenderable[] = [];
    loop.push(loop);
    await expect(renderToHtml(jsx(List, { children: loop }))).rejects.toThrow(
      "Circular"
    );
  });
});

describe("ordered list theme boundaries", () => {
  it("continues through known nested providers and fragments while inheriting each theme", async () => {
    const unknown = vi.fn(async () => jsx("span", { children: "备注" }));
    const html = await renderToHtml(
      jsx(ThemeProvider, {
        theme: {
          palette: { accentMem: "red" },
          typography: { sizes: { body: 15 } },
        },
        children: jsx(List, {
          ordered: true,
          start: 3,
          children: [
            jsx(ThemeProvider, {
              theme: { palette: { accentMem: "blue" } },
              children: [
                jsx(ListItem, { children: "Inside" }),
                jsx(ThemeProvider, {
                  theme: { typography: { sizes: { body: 18 } } },
                  children: jsx(Fragment, {
                    children: [
                      jsx(unknown, {}),
                      jsx(ListItem, {
                        marker: jsx("b", { children: "自定" }),
                        children: "Explicit",
                      }),
                      jsx(ListItem, { children: "Deep" }),
                    ],
                  }),
                }),
              ],
            }),
            jsx(ListItem, { children: "Outside" }),
          ],
        }),
      })
    );
    expect(html).toContain(">3. </div>");
    expect(html).toContain("<b>自定</b>"); // Explicit marker still consumes item 4.
    expect(html).not.toContain(">4. </div>");
    expect(html).toContain(">5. </div>");
    expect(html).toContain(">6. </div>");
    expect(html).toContain("color: blue");
    expect(html).toContain("color: red");
    expect(html).toContain("font-size: 18px");
    expect(html).toContain("font-size: 15px");
    expect(html).not.toContain(">•</div>");
    expect(unknown).toHaveBeenCalledTimes(1);
  });

  it("handles a provider directly inside a list without an outer provider", async () => {
    const html = await renderToHtml(
      jsx(List, {
        ordered: true,
        start: 3,
        children: jsx(ThemeProvider, {
          theme: { palette: { accentMem: "blue" } },
          children: jsx(ListItem, { children: "Inside" }),
        }),
      })
    );
    expect(html).toContain(">3. </div>");
    expect(html).toContain("color: blue");
    expect(html).not.toContain(">•</div>");
  });

  it("treats a nested List as an independent numbering scope", async () => {
    const html = await renderToHtml(
      jsx(List, {
        ordered: true,
        start: 3,
        children: [
          jsx(ListItem, { children: "Outer A" }),
          jsx(ThemeProvider, {
            theme: {},
            children: [
              jsx(List, {
                ordered: true,
                start: 20,
                items: ["Inner A", "Inner B"],
              }),
              jsx(ListItem, { children: "Outer B" }),
            ],
          }),
        ],
      })
    );
    expect(html).toContain(">3. </div>");
    expect(html).toContain(">4. </div>");
    expect(html).toContain(">20. </div>");
    expect(html).toContain(">21. </div>");
    expect(html).not.toContain(">5. </div>");
  });
});

describe("unordered list local theme defaults", () => {
  it("lets nested providers replace the marker and palette without a parent default overriding them", async () => {
    const html = await renderToHtml(
      jsx(ThemeProvider, {
        theme: { text: { listMarker: "•" }, palette: { accentMem: "red" } },
        children: jsx(List, {
          children: [
            jsx(ThemeProvider, {
              theme: {
                text: { listMarker: jsx("strong", { children: "★" }) },
                palette: { accentMem: "blue" },
              },
              children: jsx(ListItem, { children: "Inside" }),
            }),
            jsx(ListItem, { children: "Outside" }),
          ],
        }),
      })
    );
    expect(html.match(/<strong>★<\/strong>/g)).toHaveLength(1);
    expect(html.match(/>•<\/div>/g)).toHaveLength(1);
    expect(html).toContain("color: blue");
    expect(html).toContain("color: red");
  });
});
