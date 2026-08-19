import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  materializeOutboundBase64,
  resolveIcqqOutboundMediaMode,
} from "../src/outbound-media.js";

describe("resolveIcqqOutboundMediaMode", () => {
  it("无配置时默认 file", () => {
    expect(resolveIcqqOutboundMediaMode({})).toBe("file");
  });

  it("显式 outboundMedia 优先", () => {
    expect(resolveIcqqOutboundMediaMode({ outboundMedia: "base64" })).toBe("base64");
    expect(resolveIcqqOutboundMediaMode({ outboundMedia: "file" })).toBe("file");
  });
});

describe("materializeOutboundBase64", () => {
  it("base64 模式不落盘", () => {
    const seg = {
      type: "image" as const,
      data: { media: { kind: "base64", value: "YQ==" } },
    };
    const out = materializeOutboundBase64([seg], "base64");
    expect(out[0]).toBe(seg);
  });

  it("file 模式把 canonical MediaRef base64 落盘并改写为 path 引用", () => {
    const seg = {
      type: "image" as const,
      data: { media: { kind: "base64", value: "YQ==", mime_type: "image/png" } },
    };
    const out = materializeOutboundBase64([seg], "file");
    const data = (out[0] as typeof seg).data as Record<string, unknown>;
    const media = data.media as { kind: string; value: string };
    expect(media.kind).toBe("path");
    expect(media.value).toContain("zhin-icqq-outbound");
    expect(data.file).toBeUndefined();
    expect(data.url).toBeUndefined();
    expect(fs.existsSync(media.value)).toBe(true);
    fs.rmSync(media.value, { force: true });
  });

  it("file 模式无 canonical MediaRef 的段不物化（原样保留，由 CQ 序列化丢弃）", () => {
    const seg = { type: "image" as const, data: { base64: "YQ==" } };
    const out = materializeOutboundBase64([seg], "file");
    expect(out[0]).toBe(seg);
  });
});
