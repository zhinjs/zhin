import { describe, it, expect } from "vitest";
import { htmlToDOM, Element, Text } from "html-react-parser";
import { htmlToSvg, sanitizeHtml } from "../src/html-to-svg.ts";
import { getAllBuiltinFonts } from "../src/fonts.ts";

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

  it("preserves raw CSS while keeping title RCDATA escaped and non-executable", () => {
    const css = 'a > b { content: "< &amp; >"; }';
    expect(sanitizeHtml(`<style>${css}</style>`)).toBe(`<style>${css}</style>`);
    const svg = sanitizeHtml(`<svg><style>${css}</style></svg>`);
    expect(svg).toBe('<svg><style>a &gt; b { content: "&lt; &amp; &gt;"; }</style></svg>');
    expect(sanitizeHtml(svg)).toBe(svg);
    const hiddenMarkup = '<svg><style>&lt;/style&gt;&lt;script&gt;literal&lt;/script&gt;</style></svg>';
    expect(sanitizeHtml(hiddenMarkup)).toBe(hiddenMarkup);
    expect(sanitizeHtml(`<svg><foreignObject><style>${css}</style></foreignObject></svg>`))
      .toBe(`<svg><foreignObject><style>${css}</style></foreignObject></svg>`);
    const title = '<title>a &amp; b &lt; c &lt;/title&gt;&lt;script&gt;literal&lt;/script&gt;</title>';
    const safe = sanitizeHtml(title);
    expect(safe).toBe(title);
    const nodes = htmlToDOM(safe);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toBeInstanceOf(Element);
    const node = nodes[0] as Element;
    expect(node.name).toBe('title');
    expect(node.children).toHaveLength(1);
    expect(node.children[0]).toBeInstanceOf(Text);
    expect((node.children[0] as Text).data).toBe('a & b < c </title><script>literal</script>');
    expect(sanitizeHtml('<style>a > b { color:red }</style><script>bad()</script><p>keep</p>'))
      .toBe('<style>a > b { color:red }</style><p>keep</p>');
  });

  it("rejects excessive depth instead of silently dropping required content", async () => {
    const nested = '<div>'.repeat(102) + 'required' + '</div>'.repeat(102);
    expect(() => sanitizeHtml(nested)).toThrow('maximum sanitization depth 100');
    await expect(htmlToSvg(nested, { width: 200, fonts: getAllBuiltinFonts() }))
      .rejects.toThrow('maximum sanitization depth 100');
    expect(sanitizeHtml('<div>'.repeat(100) + 'required' + '</div>'.repeat(100)))
      .toContain('required');
  });
});
