import { describe, it, expect, vi } from "vitest";
import { materializeOutboundMedia } from "../src/outbound-media.js";

describe("materializeOutboundMedia", () => {
  const uploader = {
    uploadMedia: vi.fn(async () => "https://img.kookapp.cn/assets/test.png"),
  };

  it("base64:// 图片应先上传再替换 url", async () => {
    const out = await materializeOutboundMedia(uploader, [
      { type: "image", data: { url: "base64://YQ==", name: "a.png" } },
    ]);
    expect(uploader.uploadMedia).toHaveBeenCalledWith(expect.any(Buffer));
    expect(out[0]).toEqual({
      type: "image",
      data: {
        url: "https://img.kookapp.cn/assets/test.png",
        file: "https://img.kookapp.cn/assets/test.png",
        name: "a.png",
      },
    });
  });

  it("https URL 不触发上传", async () => {
    uploader.uploadMedia.mockClear();
    const input = [{ type: "image", data: { url: "https://example.com/a.png" } }];
    const out = await materializeOutboundMedia(uploader, input);
    expect(uploader.uploadMedia).not.toHaveBeenCalled();
    expect(out).toEqual(input);
  });

  it("data.base64 字段应上传", async () => {
    uploader.uploadMedia.mockClear();
    const out = await materializeOutboundMedia(uploader, [
      { type: "image", data: { base64: "YQ==" } },
    ]);
    expect(uploader.uploadMedia).toHaveBeenCalled();
    expect((out[0] as { data: { url: string } }).data.url).toContain("kookapp.cn");
  });
});
