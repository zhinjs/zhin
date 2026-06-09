import { segment } from "zhin.js";
import { normalizeOutboundMarkdown } from "../src/outbound-markdown.js";

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

  it("含图片段时不转换", () => {
    const input = [
      { type: "text", data: { text: "**a**" } },
      { type: "image", data: { url: "https://example.com/a.png" } },
    ];
    expect(normalizeOutboundMarkdown(input)).toEqual(input);
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
});
