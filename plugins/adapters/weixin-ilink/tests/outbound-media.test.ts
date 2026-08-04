import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { materializeOutboundMedia } from "../src/outbound-media.js";

describe("materializeOutboundMedia", () => {
  const dir = path.join(os.tmpdir(), "weixin-outbound-test");

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("kind=base64 图片应落盘并改写为 kind=path", async () => {
    const pngHeader = Buffer.from("iVBORw0KGgo=", "base64");
    const b64 = pngHeader.toString("base64");
    const out = await materializeOutboundMedia(
      [{
        type: "image",
        data: {
          media: {
            kind: "base64",
            value: b64,
            mime_type: "image/png",
            file_name: "system-status.png",
          },
        },
      }],
      dir,
    );
    const seg = out[0] as { data: { media: { kind: string; value: string } } };
    expect(seg.data.media.kind).toBe("path");
    expect(seg.data.media.value).toContain("out-image-");
    expect(seg.data.media.value.endsWith(".png")).toBe(true);
    expect(fs.existsSync(seg.data.media.value)).toBe(true);
    expect(fs.statSync(seg.data.media.value).size).toBeGreaterThan(0);
  });

  it("kind=path 本地文件直接透传为上传源", async () => {
    fs.mkdirSync(dir, { recursive: true });
    const local = path.join(dir, "local.png");
    fs.writeFileSync(local, "png-bytes");
    const out = await materializeOutboundMedia(
      [{ type: "image", data: { media: { kind: "path", value: local } } }],
      dir,
    );
    const seg = out[0] as { data: { media: { kind: string; value: string } } };
    expect(seg.data.media).toEqual({ kind: "path", value: local });
  });

  it("kind=url 远程媒体下载落盘后改写为 kind=path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new Uint8Array([1, 2, 3]),
      { status: 200, headers: { "content-type": "image/png" } },
    )));
    const out = await materializeOutboundMedia(
      [{ type: "image", data: { media: { kind: "url", value: "https://example.com/a.png" } } }],
      dir,
    );
    const seg = out[0] as { data: { media: { kind: string; value: string } } };
    expect(seg.data.media.kind).toBe("path");
    expect(fs.existsSync(seg.data.media.value)).toBe(true);
  });

  it("缺 media / kind=file / 本地文件不存在 / 下载失败一律丢弃", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const out = await materializeOutboundMedia(
      [
        { type: "text", data: { text: "hi" } },
        { type: "image", data: {} },
        { type: "image", data: { media: { kind: "file", value: "opaque-file-id" } } },
        { type: "image", data: { media: { kind: "path", value: path.join(dir, "missing.png") } } },
        { type: "image", data: { media: { kind: "url", value: "https://example.com/dead.png" } } },
      ],
      dir,
    );
    expect(out).toEqual([{ type: "text", data: { text: "hi" } }]);
  });
});
