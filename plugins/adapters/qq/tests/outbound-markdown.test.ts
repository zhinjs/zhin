import { segment } from "zhin.js";
import {
  formatQqMarkdownImage,
  normalizeOutboundMarkdown,
  resolveImageMarkdownUrl,
} from "../src/outbound-markdown.js";

describe("normalizeOutboundMarkdown", () => {
  it("auto：含 ** 时转为 markdown 段", () => {
    const out = normalizeOutboundMarkdown([
      { type: "reply", data: { id: "msg-1" } },
      { type: "text", data: { text: "你好 **世界**" } },
    ]);
    expect(out).toEqual([
      { type: "reply", data: { id: "msg-1" } },
      segment("markdown", { content: "你好 **世界**" }),
    ]);
  });

  it("auto：纯文本不转换", () => {
    const input = [{ type: "text", data: { text: "你好世界" } }];
    expect(normalizeOutboundMarkdown(input)).toEqual(input);
  });

  it("true：纯文本也转 markdown", () => {
    const out = normalizeOutboundMarkdown(
      [{ type: "text", data: { text: "plain" } }],
      true,
    );
    expect(out).toEqual([segment("markdown", { content: "plain" })]);
  });

  it("false：含 markdown 语法也不转换", () => {
    const input = [{ type: "text", data: { text: "**bold**" } }];
    expect(normalizeOutboundMarkdown(input, false)).toEqual(input);
  });

  it("false：图文混排也不转换", () => {
    const input = [
      { type: "text", data: { text: "扫码绑定" } },
      { type: "image", data: { url: "https://example.com/a.png" } },
    ];
    expect(normalizeOutboundMarkdown(input, false)).toEqual(input);
  });

  it("已是 markdown 段时不重复处理", () => {
    const input = [segment("markdown", { content: "ok" })];
    expect(normalizeOutboundMarkdown(input)).toEqual(input);
  });

  it("合并多段 text", () => {
    const out = normalizeOutboundMarkdown([
      { type: "text", data: { text: "# 标题\n\n" } },
      { type: "text", data: { text: "- item" } },
    ]);
    expect(out).toEqual([
      segment("markdown", { content: "# 标题\n\n- item" }),
    ]);
  });

  it("公网 URL 图文混排合并为 markdown", () => {
    const out = normalizeOutboundMarkdown([
      { type: "text", data: { text: "请扫码\n" } },
      { type: "image", data: { url: "https://example.com/qr.png", width: 180 } },
    ]);
    expect(out).toEqual([
      segment("markdown", {
        content: `请扫码\n${formatQqMarkdownImage("https://example.com/qr.png", { width: 180 })}`,
      }),
    ]);
  });

  it("内联 base64 图文混排留给 mixed-media 路径", () => {
    const input = [
      { type: "text", data: { text: "请扫码" } },
      { type: "image", data: { file: "base64://YQ==" } },
    ];
    expect(normalizeOutboundMarkdown(input)).toEqual(input);
  });

  it("仅图片不转换", () => {
    const input = [{ type: "image", data: { url: "https://example.com/a.png" } }];
    expect(normalizeOutboundMarkdown(input)).toEqual(input);
  });

  it("含 keyboard 时不合并图文", () => {
    const input = [
      { type: "text", data: { text: "标题" } },
      { type: "image", data: { url: "https://example.com/a.png" } },
      { type: "keyboard", data: { rows: [] } },
    ];
    expect(normalizeOutboundMarkdown(input)).toEqual(input);
  });
});

describe("resolveImageMarkdownUrl", () => {
  it("https URL 原样返回", () => {
    expect(resolveImageMarkdownUrl({ url: "https://example.com/a.png" }))
      .toBe("https://example.com/a.png");
  });

  it("base64:// 转为 data URI", () => {
    expect(resolveImageMarkdownUrl({ file: "base64://YQ==" }))
      .toBe("data:image/png;base64,YQ==");
  });
});
