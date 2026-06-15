import { describe, it, expect } from "vitest";
import * as jsxRuntime from "../src/jsx-runtime.ts";
import * as jsxDevRuntime from "../src/jsx-dev-runtime.ts";
import { jsx, Fragment, renderJSX } from "../src/jsx.ts";
import { Card, CardHeader, StatChip, Row } from "../src/html-components.ts";
import { htmlToSvg, getAllBuiltinFonts } from "../src/index.ts";

describe("satori jsx-runtime", () => {
  it("exports jsx / jsxs / Fragment / renderJSX", () => {
    expect(typeof jsxRuntime.jsx).toBe("function");
    expect(typeof jsxRuntime.jsxs).toBe("function");
    expect(jsxRuntime.Fragment).toBeDefined();
    expect(typeof jsxRuntime.renderJSX).toBe("function");
    expect(jsxRuntime.default.jsx).toBe(jsxRuntime.jsx);
  });

  it("exports jsxDEV from jsx-dev-runtime", () => {
    expect(typeof jsxDevRuntime.jsxDEV).toBe("function");
    expect(jsxDevRuntime.jsxDEV).toBe(jsxRuntime.jsx);
  });

  it("jsx 调用内置 HtmlComponent 产出 HTML 字符串", () => {
    const html = jsx(Card, {
      children: [
        jsx(CardHeader, { title: "统计", meta: "今日" }),
        jsx(Row, {
          children: jsx(StatChip, { label: "消息", value: "42" }),
        }),
      ],
    });
    expect(typeof html).toBe("string");
    expect(html).toContain("统计");
    expect(html).toContain("42");
    expect(html).toContain("<div");
  });

  it("Fragment 展平子节点", () => {
    const html = jsx(Fragment, {
      children: [jsx("span", { children: "a" }), jsx("span", { children: "b" })],
    });
    expect(html).toBe("<span>a</span><span>b</span>");
  });

  it("原生标签支持 style 对象与转义", () => {
    const html = jsx("div", {
      style: { display: "flex", paddingTop: 8 },
      children: "<unsafe>",
    });
    expect(html).toContain('style="display: flex; padding-top: 8"');
    expect(html).toContain("&lt;unsafe&gt;");
  });

  it("renderJSX 兼容 lazy tree", () => {
    const html = renderJSX({
      type: CardHeader,
      props: { title: "lazy" },
    });
    expect(html).toContain("lazy");
  });

  it("JSX 卡片可通过 htmlToSvg 渲染", async () => {
    const html = jsx(Card, {
      children: jsx(CardHeader, { title: "JSX 卡片" }),
    });
    const svg = await htmlToSvg(html, { width: 540, fonts: getAllBuiltinFonts() });
    expect(svg).toContain("<svg");
  });
});
