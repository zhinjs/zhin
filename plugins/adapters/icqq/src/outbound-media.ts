import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { isMediaRef } from "@zhin.js/core";
import type { MessageSegment, SendContent } from "zhin.js";
import type { IcqqEndpointConfig } from "./types.js";

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

export function resolveIcqqOutboundMediaMode(
  config: Pick<IcqqEndpointConfig, "outboundMedia">,
): IcqqOutboundMediaMode {
  if (config.outboundMedia === "base64" || config.outboundMedia === "file") {
    return config.outboundMedia;
  }
  return "file";
}

/**
 * file 模式：将 canonical MediaRef（`data.media`，kind=base64）物化为本机路径，
 * 并把 media 改写为 path 引用（icqq 客户端直接读盘）。
 * base64 模式：不改动（由 toCqString/formatOutboundBody 生成 base64://）。
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
    const media = d.media;
    if (!isMediaRef(media) || media.kind !== "base64") return seg;
    const b64 = media.value.replace(/^base64:\/\//, "");
    if (!b64) return seg;
    if (type !== "image" && type !== "record" && type !== "audio" && type !== "video") {
      return seg;
    }

    const mime = media.mime_type ?? "";
    const filePath = spoolBase64ToFile(
      b64,
      mime || (type === "image" ? "image/jpeg" : type === "video" ? "video/mp4" : "audio/mpeg"),
      type === "record" || type === "audio" ? "audio" : type,
    );
    return {
      type,
      data: {
        ...d,
        media: {
          kind: "path",
          value: filePath,
          ...(mime ? { mime_type: mime } : {}),
        },
      },
    } as MessageSegment;
  });
}
