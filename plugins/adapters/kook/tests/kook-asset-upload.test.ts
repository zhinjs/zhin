import { describe, it, expect, vi } from "vitest";
import { uploadKookAsset } from "../src/kook-asset-upload.js";

describe("uploadKookAsset", () => {
  it("Buffer 应包装为 Blob 后上传", async () => {
    const post = vi.fn().mockResolvedValue({ data: { url: "https://img.kookapp.cn/assets/a.png" } });
    const url = await uploadKookAsset({ post } as never, Buffer.from("YQ==", "base64"));
    expect(url).toBe("https://img.kookapp.cn/assets/a.png");
    expect(post).toHaveBeenCalledWith(
      "/v3/asset/create",
      expect.any(FormData),
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("https URL 应直接透传", async () => {
    const post = vi.fn();
    const url = await uploadKookAsset({ post } as never, "https://img.kookapp.cn/x.png");
    expect(url).toBe("https://img.kookapp.cn/x.png");
    expect(post).not.toHaveBeenCalled();
  });

  it("base64:// 字符串应解码上传", async () => {
    const post = vi.fn().mockResolvedValue({ data: { url: "https://img.kookapp.cn/assets/b.png" } });
    const url = await uploadKookAsset({ post } as never, "base64://YQ==");
    expect(url).toContain("kookapp.cn");
  });
});
