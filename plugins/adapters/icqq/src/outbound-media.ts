import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { MessageSegment, SendContent } from "zhin.js";
import type { IcqqBotConfig } from "./types.js";

export type IcqqOutboundMediaMode = "file" | "base64";

function extForMime(mime: string, fallback: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "video/mp4": ".mp4",
  };
  return map[mime] || fallback;
}

function spoolBase64ToFile(
  base64: string,
  mime: string,
  kind: string,
): string {
  const dir = path.join(os.tmpdir(), "zhin-icqq-outbound");
  fs.mkdirSync(dir, { recursive: true });
  const ext = extForMime(mime, kind === "audio" ? ".mp3" : kind === "video" ? ".mp4" : ".bin");
  const filePath = path.join(dir, `${kind}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

/**
 * 出站媒体模式：file=本机落盘后 CQ [image:path]（与 icqq 同机时可用）；
 * base64=保留 segment.base64，CQ 编码为 [image:base64://...] 经 IPC 交给守护进程解码（异机 RPC 默认）。
 */
export function resolveIcqqOutboundMediaMode(
  config: Pick<IcqqBotConfig, "rpc" | "outboundMedia">,
): IcqqOutboundMediaMode {
  if (config.outboundMedia === "base64" || config.outboundMedia === "file") {
    return config.outboundMedia;
  }
  return config.rpc ? "base64" : "file";
}

/**
 * file 模式：将 segment.data.base64 物化为本机路径。
 * base64 模式：不改动（由 toCqString 生成 base64://，供异机守护进程读取）。
 */
export function materializeOutboundBase64(
  content: SendContent,
  mode: IcqqOutboundMediaMode = "file",
): SendContent {
  if (mode === "base64") return content;

  const segments = Array.isArray(content) ? content : [content];
  return segments.map((seg) => {
    if (typeof seg === "string") return seg;
    const { type, data } = seg as MessageSegment;
    const d = data as Record<string, unknown>;
    const b64 = d.base64 ?? d.data;
    if (typeof b64 !== "string" || !b64) return seg;

    const mime = String(d.mime ?? d.mimeType ?? "");
    if (type === "image" || type === "record" || type === "audio" || type === "video") {
      const filePath = spoolBase64ToFile(
        b64,
        mime || (type === "image" ? "image/jpeg" : type === "video" ? "video/mp4" : "audio/mpeg"),
        type === "record" || type === "audio" ? "audio" : type,
      );
      return {
        type,
        data: {
          ...d,
          file: filePath,
          url: filePath,
        },
      } as MessageSegment;
    }
    return seg;
  });
}
