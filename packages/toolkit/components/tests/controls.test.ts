import { jsx, renderToHtml, type JSXNode } from "@zhin.js/jsx";
import { getAllBuiltinFonts, htmlToSvg } from "../../satori/src/index.js";
import { Button, Checkbox, Radio, Switch } from "../src/controls.js";
import { ThemeProvider } from "../src/theme.js";

const controls = [Checkbox, Radio, Switch] as const;

describe("display controls", () => {
  it.each(controls)(
    "renders %s checked and disabled states as static illustrations",
    async (Component) => {
      const unchecked = await renderToHtml(jsx(Component, { label: "未选择" }));
      const checked = await renderToHtml(
        jsx(Component, { checked: true, label: "已选择" })
      );
      const disabled = await renderToHtml(
        jsx(Component, { checked: true, disabled: true, label: "不可用" })
      );
      expect(unchecked).toContain("<svg");
      expect(checked).toContain("#3b82f6");
      expect(disabled).toContain("opacity: 0.55");
      expect(disabled).toContain("color: #a1a1aa");
      expect(checked).not.toBe(unchecked);
      expect(disabled).not.toMatch(/<(?:input|button)\b|\bon\w+=|\btabindex=/);
      if (Component === Checkbox) {
        expect(unchecked).not.toContain("<path");
        expect(checked).toContain('stroke-linecap="round"');
      } else if (Component === Radio) {
        expect(unchecked.match(/<circle/g)).toHaveLength(1);
        expect(checked.match(/<circle/g)).toHaveLength(2);
      } else {
        expect(unchecked).toContain('cx="12"');
        expect(checked).toContain('cx="32"');
      }
    }
  );

  it("keeps async labels, zero and local display overrides as nodes", async () => {
    async function Label(): Promise<JSXNode> {
      return jsx("b", { children: "<Ready>" });
    }
    const html = await renderToHtml([
      jsx(Checkbox, { children: Label() }),
      jsx(Radio, { label: 0 }),
      jsx(Switch, { custom: { text: { label: Label() } } }),
      jsx(Button, { label: "old", custom: { text: { label: Label() } } }),
    ]);
    expect(html.match(/<b>&lt;Ready&gt;<\/b>/g)).toHaveLength(3);
    expect(html).toMatch(/>0<\/div>/);
    expect(html).not.toContain("old");
    expect(html).not.toContain("[object Object]");
    const hidden = await renderToHtml(
      jsx(Button, { label: null, children: "fallback" })
    );
    expect(hidden).not.toContain("fallback");
  });

  it("uses theme tokens and keeps custom.style on the actual visual root", async () => {
    const html = await renderToHtml(
      jsx(ThemeProvider, {
        theme: {
          palette: {
            accentMem: "#135790",
            barCrit: "#bb2244",
            textSecondary: "#334455",
          },
          typography: { sizes: { body: 18 }, weights: { strong: 650 } },
          spacing: { xs: 8, sm: 12 },
          components: {
            Button: { background: "gold" },
            Checkbox: { margin: 0 },
          },
        },
        children: [
          jsx(Checkbox, { checked: true, label: "主题" }),
          jsx(Button, {
            variant: "danger",
            custom: { style: { background: "purple", padding: 0 } },
            children: "危险",
          }),
        ],
      })
    );
    expect(html).toContain('stroke="#135790"');
    expect(html).toContain("font-size: 18px");
    expect(html).toContain("font-weight: 650");
    expect(html).toContain("gap: 12px");
    expect(html).toContain("margin: 0");
    expect(html).toContain("background: purple");
    expect(html).toContain("padding: 0");
    expect(html).not.toContain("background: gold");
    expect(html).not.toMatch(/\s(?:custom|theme|checked|disabled)=/);
    const root = Button({ custom: { style: { background: "tomato" } } });
    expect(root.type).toBe("div");
    expect(root.props.style).toMatchObject({ background: "tomato" });
  });

  it("renders button variants and sizes with symmetric four-pixel spacing", async () => {
    const primary = await renderToHtml(jsx(Button, { children: "主操作" }));
    const secondary = await renderToHtml(
      jsx(Button, { variant: "secondary", children: "次操作" })
    );
    const danger = await renderToHtml(
      jsx(Button, { variant: "danger", disabled: true, children: "删除" })
    );
    expect(primary).toContain("background: #3b82f6");
    expect(secondary).toContain("background: #f8f9fb");
    expect(danger).toContain("background: #ef4444");
    expect(danger).toContain("opacity: 0.55");
    const sizes = await Promise.all(
      (["sm", "md", "lg"] as const).map((size) =>
        renderToHtml(jsx(Button, { size, label: 0 }))
      )
    );
    expect(sizes[0]).toContain("padding: 4px 8px");
    expect(sizes[1]).toContain("padding: 8px 16px");
    expect(sizes[2]).toContain("padding: 12px 24px");
    expect(sizes.join("")).not.toMatch(
      /(?:padding|margin)-(?:left|right|top|bottom):/
    );
  });

  it("keeps accent foregrounds independent of a dark card surface", async () => {
    const html = await renderToHtml(
      jsx(ThemeProvider, {
        theme: { palette: { card: "#101820", onAccent: "#fff8d0" } },
        children: [
          jsx(Checkbox, { checked: true }),
          jsx(Switch, { checked: true }),
          jsx(Button, { label: "Confirm" }),
        ],
      })
    );
    expect(html).toContain('stroke="#fff8d0"');
    expect(html).toContain('fill="#fff8d0"');
    expect(html).toContain("color: #fff8d0");
    expect(html).not.toContain("color: #101820");
    const svg = await htmlToSvg(html, {
      width: 240,
      fonts: getAllBuiltinFonts(),
    });
    expect(svg).toContain("#fff8d0");
  });

  it("renders all control states and button variants through real Satori SVG", async () => {
    const rows = controls.flatMap((Component) =>
      [false, true].flatMap((checked) =>
        [false, true].map((disabled) =>
          jsx(Component, {
            checked,
            disabled,
            label: Promise.resolve(
              jsx("b", {
                children: `${Component.name} ${checked ? "on" : "off"}`,
              })
            ),
          })
        )
      )
    );
    rows.push(
      ...(["primary", "secondary", "danger"] as const).flatMap((variant) =>
        [false, true].map((disabled) =>
          jsx(Button, {
            variant,
            disabled,
            children: variant,
          })
        )
      )
    );
    const html = await renderToHtml(
      jsx("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          padding: 16,
          background: "#ffffff",
        },
        children: rows,
      })
    );
    const svg = await htmlToSvg(html, {
      width: 360,
      fonts: getAllBuiltinFonts(),
    });
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
    const height = Number(svg.match(/<svg[^>]*\bheight="([\d.]+)"/)?.[1]);
    expect(height).toBeGreaterThan(400);
    expect(svg).toContain("#3b82f6");
    expect(svg).toContain("#ef4444");
  });
});
