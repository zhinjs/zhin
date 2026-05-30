import { describe, it, expect } from "vitest";
import {
  buildIcqqIpcMessage,
  parseCqMessage,
  toCqString,
} from "../src/cq-message.js";

describe("buildIcqqIpcMessage", () => {
  it("reply + 正文编码为 [reply:id] 前缀字符串", () => {
    expect(
      buildIcqqIpcMessage([
        { type: "reply", data: { id: "M0zHrrS7mJ0AC8rBcOxj/moZcDUB" } },
        { type: "text", data: { text: "hello" } },
      ]),
    ).toBe("[reply:M0zHrrS7mJ0AC8rBcOxj/moZcDUB]hello");
  });

  it("仅 reply 段时仍为非空字符串", () => {
    expect(
      buildIcqqIpcMessage([{ type: "reply", data: { id: "abc" } }]),
    ).toBe("[reply:abc]");
  });
});

describe("parseCqMessage reply with slash", () => {
  it("解析含 / 的 reply id", () => {
    const segs = parseCqMessage(
      "[reply:M0zHrrS7mJ0AC8rBcOxj/moZcDUB]正文",
    );
    expect(segs[0]).toEqual({
      type: "reply",
      data: { id: "M0zHrrS7mJ0AC8rBcOxj/moZcDUB" },
    });
    expect(segs[1]).toEqual({ type: "text", data: { text: "正文" } });
  });
});

describe("toCqString (legacy)", () => {
  it("仍可用于 CQ 序列化", () => {
    expect(
      toCqString([
        { type: "reply", data: { id: "x/y" } },
        { type: "text", data: { text: "hi" } },
      ]),
    ).toBe("[reply:x/y]hi");
  });
});
