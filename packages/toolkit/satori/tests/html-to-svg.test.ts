import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../src/html-to-svg.ts";

describe("sanitizeHtml", () => {
  it("script 连同内容删除", () => {
    expect(sanitizeHtml("<div>a</div><script>alert(1)</script>")).toBe("<div>a</div>");
  });

  it("form/input 剥标签但保留文本内容", () => {
    const out = sanitizeHtml('<form action="/x"><p>用户名</p><input value="abc"></form>');
    expect(out).not.toMatch(/<\/?form/i);
    expect(out).not.toMatch(/<input/i);
    expect(out).toContain("用户名");
    expect(out).toContain("<p>");
  });

  it("事件处理属性被移除", () => {
    expect(sanitizeHtml('<div onclick="alert(1)">x</div>')).toBe("<div>x</div>");
  });
});
