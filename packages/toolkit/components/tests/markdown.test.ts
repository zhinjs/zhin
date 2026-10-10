import { jsx, renderToHtml } from "@zhin.js/jsx";
import { htmlToDOM, Element, Text, type DOMNode } from "html-react-parser";
import { renderImage, colorBox } from "./render-image.js";
import { Markdown } from "../src/markdown.js";
import { ThemeProvider } from "../src/theme.js";

const htmlOf = (source: string) => renderToHtml(jsx(Markdown, { source }));

function nodeText(node: DOMNode): string {
  if (node instanceof Text) return node.data;
  return node instanceof Element
    ? node.children.map((child) => nodeText(child as DOMNode)).join("")
    : "";
}

function htmlTextContent(html: string): string {
  return htmlToDOM(html).map(nodeText).join("");
}


describe("safe Markdown JSX", () => {
  it("extracts parsed text without treating escaped tags or quoted angle brackets as markup", () => {
    expect(htmlTextContent('<div title="a > b">before <b>console</b>.log &lt;tag&gt; &amp;lt;<!-- ignored --></div>'))
      .toBe("before console.log <tag> &lt;");

  });

  it("renders inline formatting and text entities without re-escaping content", async () => {
    const html = await htmlOf(
      "# 标题\n\n**strong** *em* ~~old~~ `&amp; <tag>` &copy; &amp; &lt;safe&gt;\nsoft\n\nhard  \nbreak"
    );
    expect(html).toContain("<h1");
    expect(html).toMatch(/<strong[^>]*>strong<\/strong>/);
    expect(html).toMatch(/<em[^>]*>em<\/em>/);
    expect(html).toMatch(/<del[^>]*>old<\/del>/);
    expect(html).toContain("&amp;amp; &lt;tag&gt;"); // Code preserves entity source literally.
    expect(html).toContain("© &amp; &lt;safe&gt; soft");
    expect(html).toContain("hard\nbreak");
    expect(await htmlOf("&copycat")).toContain("&amp;copycat");
  });

  it("supports reference links and only retains explicit allowed or relative hrefs", async () => {
    const html = await htmlOf(
      '[https](https://example.com?a=1&b=2 "a <title>") [mail](mailto:team@example.com) [relative](../guide) [anchor](#intro) [ref][id]\n\n[id]: /docs'
    );
    expect(html).toContain('href="https://example.com?a=1&amp;b=2"');
    expect(html).toContain('title="a &lt;title&gt;"');
    expect(html).toContain('href="mailto:team@example.com"');
    expect(html).toContain('href="../guide"');
    expect(html).toContain('href="#intro"');
    expect(html).toContain('href="/docs"');
  });

  it.each([
    "javascript:alert%281%29",
    "java&#x73;cript:alert%281%29",
    "java&#x0a;script:alert%281%29",
    "javascript&colon;alert%281%29",
    "vbscript:alert%281%29",
    "data:text/html;base64,PHNjcmlwdD4=",
    "//untrusted.example/path",
  ])("renders the label without a link for unsafe href %s", async (href) => {
    const html = await htmlOf(`[Visible](${href})`);
    expect(html).toContain("Visible");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<a ");
  });

  it("renders raw HTML as literal text and never fetches Markdown images", async () => {
    const html = await htmlOf(
      '<script>alert("x")</script>\n\n<img src="https://untrusted.example/image.png" onerror="alert(1)">\n\n![diagram <caption>](https://untrusted.example/diagram.svg)'
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=");
    expect(html).toContain("diagram &lt;caption&gt;");
    expect(html).not.toMatch(/<(?:script|img|iframe)\b/);
    expect(html).not.toContain('src="https://untrusted.example');
  });

  it("builds ordered, nested and task lists and aligned GFM tables from components", async () => {
    const html = await htmlOf(
      "3. first\n4. second\n   - nested\n\n- [x] done\n- [ ] waiting\n\n| Left | Right |\n| :--- | ---: |\n| **A** | `B` |\n\n---"
    );
    expect(html).toContain("3.");
    expect(html).toContain("4.");
    expect(html).toContain("nested");
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain("waiting");
    expect(html).toContain('role="table"');
    expect(html).toContain('role="columnheader"');
    expect(html).toContain("text-align: right");
    expect(html).toMatch(/<strong[^>]*>A<\/strong>/);
    expect(html).not.toMatch(/<(?:ul|ol|li|input|table)\b/);
    expect(html).toContain("background: rgba(0,0,0,0.06)");
  });

  it("uses scoped theme and local root style without rewriting parser input", async () => {
    const html = await renderToHtml(
      jsx(ThemeProvider, {
        theme: {
          palette: { text: "#224466", accentMem: "#336699" },
          components: { Markdown: { background: "gold" } },
        },
        children: jsx(Markdown, {
          source: "# Source\n\n[Link](/guide)",
          custom: {
            style: { background: "ivory", margin: 0 },
            text: { content: "must not rewrite source" },
          },
        }),
      })
    );
    expect(html).toContain("Source");
    expect(html).toContain("color: #224466");
    expect(html).toContain("color: #336699");
    expect(html).toContain("background: ivory");
    expect(html).not.toContain("background: gold");
    expect(html).not.toContain("must not rewrite source");
    expect(html).not.toMatch(/\s(?:theme|custom|source)=/);
    expect(
      await renderToHtml(jsx(Markdown, { children: "**children**" }))
    ).toMatch(/<strong[^>]*>children<\/strong>/);
  });

  it("rejects oversized sources and deeply nested parser trees", async () => {
    await expect(htmlOf("x".repeat(100_001))).rejects.toThrow(
      "maximum source length"
    );
    await expect(htmlOf(">".repeat(30) + " depth")).rejects.toThrow(
      "maximum token depth"
    );
    await expect(htmlOf(">".repeat(20_000) + " depth")).rejects.toThrow(
      "maximum token depth"
    );
    await expect(htmlOf("paragraph\n\n".repeat(5_001))).rejects.toThrow(
      "maximum token count"
    );
  });

  it("renders a nested document including fenced code through real Chromium PNG", async () => {
    const source =
      '# Release\n\n**Ready** with *checks*, ~~old~~ and `const n = 0`. [Docs](https://example.com/docs)\n\n> Summary\n>\n> ```ts\n> const ready = true;\n> console.log("<safe>");\n> ```\n\n1. Verify\n   - [x] Build\n   - [ ] Publish\n\n| Check | Result |\n| --- | ---: |\n| Smoke | **Pass** |\n\n![No download](https://untrusted.example/image.png)';
    const html = await htmlOf(source);
    expect(htmlTextContent(html)).toContain("console.log");
    expect(html).toContain("&lt;safe&gt;");
    expect(html).not.toContain("<img");
    const image = await renderImage(html, 540);
    expect(image.height).toBeGreaterThan(200);
    expect(colorBox(image, "#D73A49").pixels).toBeGreaterThan(5);
    expect(colorBox(image, "#3b82f6").pixels).toBeGreaterThan(5);

  });

  it("preserves attribute-looking Markdown and code text through the HTML serialization and browser screenshot", async () => {
    const literal = '<span onclick="keep this">literal</span>';
    const source = `${literal}\n\nExample href=javascript:alert(1) stays literal\n\n\`\`\`text\n${literal}\n\`\`\``;
    const html = await htmlOf(source);
    const text = htmlTextContent(html);
    expect(text.split(literal)).toHaveLength(3);
    expect(text).toContain("Example href=javascript:alert(1) stays literal");
    expect(text).not.toContain("about:invalid");
    const image = await renderImage(html, 900);
    expect(image.height).toBeGreaterThan(100);
    // Hide only the fenced code tokens while preserving their boxes and text.
    // A differential screenshot measures painted glyphs including antialiasing,
    // rather than requiring a font-dependent count of exact foreground RGBs.
    const hidden = await renderImage(
      '<style>[data-code-line-number] + div > span { visibility: hidden !important; }</style>' + html,
      900
    );
    expect(hidden.height).toBe(image.height);
    let changedPixels = 0;
    let left = image.width, right = -1, top = image.height, bottom = -1;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const index = (y * image.width + x) * 4;
        if (![0, 1, 2, 3].some(channel => image.data[index + channel] !== hidden.data[index + channel])) continue;
        changedPixels++;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    expect(changedPixels).toBeGreaterThan(literal.length * 4);
    expect(right - left + 1).toBeGreaterThan(100);
    expect(bottom - top + 1).toBeGreaterThan(5);

  });
});
