import { describe, it, expect } from "vitest";
import { convertToKookSendable } from "../src/outbound-sendable.js";

describe("convertToKookSendable", () => {
  const formatText = (els: unknown[]) => `text:${els.length}`;

  it("单张图片应转为 image 段而非 Markdown", () => {
    const out = convertToKookSendable(
      [{ type: "image", data: { url: "https://img.kookapp.cn/a.png" } }],
      formatText,
    );
    expect(out).toEqual([
      { type: "image", url: "https://img.kookapp.cn/a.png" },
    ]);
  });

  it("reply + 图片应保留 reply 段", () => {
    const out = convertToKookSendable(
      [
        { type: "reply", data: { id: "msg-1" } },
        { type: "image", data: { url: "https://img.kookapp.cn/a.png" } },
      ],
      formatText,
    );
    expect(out).toEqual([
      { type: "reply", id: "msg-1" },
      { type: "image", url: "https://img.kookapp.cn/a.png" },
    ]);
  });

  it("纯文本仍走 formatText", () => {
    const out = convertToKookSendable(
      [{ type: "text", data: { text: "hi" } }],
      () => "hello",
    );
    expect(out).toBe("hello");
  });
});
