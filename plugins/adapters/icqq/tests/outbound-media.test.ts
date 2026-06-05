import { describe, it, expect } from "vitest";
import {
  materializeOutboundBase64,
  resolveIcqqOutboundMediaMode,
} from "../src/outbound-media.js";

describe("resolveIcqqOutboundMediaMode", () => {
  it("配置 rpc 时默认 base64", () => {
    expect(
      resolveIcqqOutboundMediaMode({
        rpc: { host: "1.2.3.4", port: 9, token: "t" },
      }),
    ).toBe("base64");
  });

  it("显式 outboundMedia 优先", () => {
    expect(
      resolveIcqqOutboundMediaMode({
        rpc: { host: "1.2.3.4", port: 9, token: "t" },
        outboundMedia: "file",
      }),
    ).toBe("file");
  });
});

describe("materializeOutboundBase64", () => {
  it("base64 模式不落盘", () => {
    const seg = { type: "image" as const, data: { base64: "YQ==" } };
    const out = materializeOutboundBase64([seg], "base64");
    expect((out[0] as typeof seg).data.base64).toBe("YQ==");
    expect((out[0] as typeof seg).data.file).toBeUndefined();
  });
});
