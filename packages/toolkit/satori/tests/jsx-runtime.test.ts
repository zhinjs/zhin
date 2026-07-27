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

  it("Fragment 展平子节点（文本一律转义）", () => {
    expect(jsx(Fragment, { children: ["a", "b"] })).toBe("ab");
    // HTML 片段组合走显式通道：函数组件（如 Raw）在顶层使用
    expect(jsx(Fragment, { children: "<span>a</span>" })).toBe(
      "&lt;span&gt;a&lt;/span&gt;",
    );
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

  it("boolean children 一律渲染为空串", () => {
    expect(jsx("div", { children: true })).toBe("<div></div>");
    expect(jsx("div", { children: ["a", true, false, "b"] })).toBe("<div>ab</div>");
  });

  it("文本子节点一律转义，不再启发式放行 HTML", () => {
    // 该字符串在旧启发式下会被当作「单个 HTML 元素」原样放行
    expect(jsx("div", { children: "<b>hi</b>" })).toBe(
      "<div>&lt;b&gt;hi&lt;/b&gt;</div>",
    );
  });

  it("Raw HTML 只走显式通道 dangerouslySetInnerHTML", () => {
    expect(
      jsx("div", { dangerouslySetInnerHTML: { __html: "<b>raw</b>" } }),
    ).toBe("<div><b>raw</b></div>");
  });
});
