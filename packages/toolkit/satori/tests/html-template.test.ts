import { describe, it, expect } from "vitest";
import { e, html, htmlSafe, tightHtml } from "../src/html-template.ts";

describe("html-template", () => {
  it("html 拼接模板字符串", () => {
    const name = "Alice";
    expect(html`<div>${e(name)}</div>`).toBe("<div>Alice</div>");
  });

  it("htmlSafe 自动转义字符串", () => {
    expect(htmlSafe`<p>${"<script>"}</p>`).toBe("<p>&lt;script&gt;</p>");
  });

  it("tightHtml 压缩标签间空白", () => {
    expect(tightHtml("<div>  \n  <span></span>  </div>")).toBe("<div><span></span></div>");
  });
});
