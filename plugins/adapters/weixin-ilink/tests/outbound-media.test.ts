import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { materializeOutboundMedia } from "../src/outbound-media.js";

describe("materializeOutboundMedia", () => {
  const dir = path.join(os.tmpdir(), "weixin-outbound-test");

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("base64:// 图片应落盘并写入 file 字段", async () => {
    const pngHeader = Buffer.from("iVBORw0KGgo=", "base64");
    const b64 = pngHeader.toString("base64");
    const out = await materializeOutboundMedia(
      [{ type: "image", data: { url: `base64://${b64}`, name: "system-status.png" } }],
      dir,
    );
    const seg = out[0] as { data: { file: string } };
    expect(seg.data.file).toContain("out-image-");
    expect(seg.data.file.endsWith(".png")).toBe(true);
    expect(fs.existsSync(seg.data.file)).toBe(true);
    expect(fs.statSync(seg.data.file).size).toBeGreaterThan(0);
  });
});
