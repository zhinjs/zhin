import { normalizeOutboundMedia } from "../src/outbound-media.js";

describe("normalizeOutboundMedia", () => {
  it("base64:// url 转为 file", () => {
    const input = [{ type: "image", data: { url: "base64://YQ==", name: "a.png" } }];
    expect(normalizeOutboundMedia(input)).toEqual([
      { type: "image", data: { file: "base64://YQ==", name: "a.png" } },
    ]);
  });

  it("data: URI url 转为 file", () => {
    const input = [{ type: "image", data: { url: "data:image/png;base64,YQ==" } }];
    expect(normalizeOutboundMedia(input)).toEqual([
      { type: "image", data: { file: "data:image/png;base64,YQ==" } },
    ]);
  });

  it("base64 字段转为 base64:// file", () => {
    const input = [{ type: "image", data: { base64: "YQ==" } }];
    expect(normalizeOutboundMedia(input)).toEqual([
      { type: "image", data: { file: "base64://YQ==" } },
    ]);
  });

  it("https URL 保持不变", () => {
    const input = [{ type: "image", data: { url: "https://example.com/a.png" } }];
    expect(normalizeOutboundMedia(input)).toEqual(input);
  });

  it("reply + image 仅转换媒体段", () => {
    const input = [
      { type: "reply", data: { id: "1" } },
      { type: "image", data: { url: "base64://YQ==" } },
    ];
    expect(normalizeOutboundMedia(input)).toEqual([
      { type: "reply", data: { id: "1" } },
      { type: "image", data: { file: "base64://YQ==" } },
    ]);
  });
});
