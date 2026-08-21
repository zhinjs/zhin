import { describe, it, expect } from "vitest";
import {
  parseCqMessage,
} from "../src/cq-message.js";

describe("parseCqMessage reply with slash", () => {
  it("解析含 / 的 reply id", () => {
    const segs = parseCqMessage(
      "[reply:M0zHrrS7mJ0AC8rBcOxj/moZcDUB]正文",
    );
    expect(segs[0]).toEqual({
      type: "reply",
      data: { message_id: "M0zHrrS7mJ0AC8rBcOxj/moZcDUB" },
    });
    expect(segs[1]).toEqual({ type: "text", data: { text: "正文" } });
  });
});

describe("parseCqMessage media", () => {
  it("[image:url] 解析为 canonical MediaRef", () => {
    const segs = parseCqMessage("[image:https://x/a.jpg]");
    expect(segs[0]).toEqual({
      type: "image",
      data: { media: { kind: "url", value: "https://x/a.jpg" } },
    });
  });

  it("[record:base64://...] 解析为 base64 MediaRef", () => {
    const segs = parseCqMessage("[record:base64://QUJD]");
    expect(segs[0]).toEqual({
      type: "record",
      data: { media: { kind: "base64", value: "QUJD" } },
    });
  });
});
