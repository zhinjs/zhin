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

  it("preserves escaped code and attribute-looking text while cleaning actual attributes", () => {
    const literal = '&lt;span onclick=&quot;keep this&quot;&gt;literal&lt;/span&gt; href=javascript:alert(1)';
    const safe = sanitizeHtml(`<div onclick="alert(1)" title="example onclick=keep" href="javascript&#58;alert(1)">${literal}</div>`);
    expect(safe).toContain('title="example onclick=keep"');
    expect(safe).toContain('href="about:invalid"');
    expect(safe).not.toContain('onclick="alert(1)"');
    expect(safe).toContain('&lt;span onclick="keep this"&gt;literal&lt;/span&gt; href=javascript:alert(1)');
  });

  it("handles quoted angle brackets and entity-obfuscated URI attributes structurally", () => {
    const safe = sanitizeHtml('<div title="a > b onclick=example"><a href="javascript&colon;alert(1)" ONLOAD="bad()">x</a><img src="data:text/html,unsafe"></div>');
    expect(safe).toContain('title="a &gt; b onclick=example"');
    expect(safe).toContain('<a href="about:invalid">x</a>');
    expect(safe).toContain('<img src="about:invalid">');
    expect(sanitizeHtml('<img src="data:image/png;base64,abc"><p>keep</p>')).toContain('data:image/png;base64,abc');
  });
});
