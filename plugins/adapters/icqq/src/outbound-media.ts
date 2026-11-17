import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { isMediaRef } from '@zhin.js/im-contract';
import { fetchOutboundMedia, isOutboundMediaRefused, outboundMediaNotice, type OutboundMediaFetcher } from '@zhin.js/core';
import type { MessageSegment, SendContent } from "zhin.js";
import type { IcqqEndpointConfig } from "./protocol.js";

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
 * base64 模式：不改动（由 native Sendable projection 生成 base64:// file）。
 */
export interface PreparedIcqqOutboundMedia {
  readonly content: SendContent;
  dispose(): void;
}

export function prepareIcqqOutboundMedia(
  content: SendContent,
  mode: IcqqOutboundMediaMode = "file",
): PreparedIcqqOutboundMedia {
  if (mode === "base64") return { content, dispose() {} };

  const createdFiles: string[] = [];
  const inputWasArray = Array.isArray(content);
  const segments = Array.isArray(content) ? content : [content];
  const materialized = segments.map((seg) => {
    if (typeof seg === "string") return seg;
    const { type, data } = seg as MessageSegment;
    if (!data || typeof data !== "object") return seg;
    const d = data as Record<string, unknown>;
    const media = d.media;
    let b64 = "";
    let mime = "";
    if (isMediaRef(media) && media.kind === "base64") {
      b64 = media.value.replace(/^base64:\/\//, "");
      mime = media.mime_type ?? "";
    } else if (typeof d.file === "string" && d.file.startsWith("base64://")) {
      b64 = d.file.slice("base64://".length);
    }
    if (!b64) return seg;
    if (type !== "image" && type !== "record" && type !== "audio" && type !== "video") {
      return seg;
    }

    const filePath = spoolBase64ToFile(
      b64,
      mime || (type === "image" ? "image/jpeg" : type === "video" ? "video/mp4" : "audio/mpeg"),
      type === "record" || type === "audio" ? "audio" : type,
    );
    createdFiles.push(filePath);
    return {
      type,
      data: {
        ...d,
        ...(typeof d.file === "string" && d.file.startsWith("base64://") ? { file: filePath } : {}),
        media: {
          kind: "path",
          value: filePath,
          ...(mime ? { mime_type: mime } : {}),
        },
      },
    } as MessageSegment;
  });
  return {
    content: inputWasArray ? materialized : materialized[0]!,
    dispose() {
      for (const filePath of createdFiles) fs.rmSync(filePath, { force: true });
    },
  };
}

const REMOTE_MEDIA_TYPES = new Set(["image", "record", "audio", "video", "file"]);

/**
 * `@icqqjs/icqq` downloads an http(s) media `file` on this host before uploading it. A URL MediaRef is
 * therefore downloaded here first, through core `fetchOutboundMedia` (public HTTPS only, pinned DNS,
 * every redirect checked, size and time bounded), and handed to the SDK as base64; a refused URL
 * becomes a notice text segment and the rest of the message is still sent (#1250 第 46 批).
 */
export async function fetchIcqqRemoteMedia(
  content: SendContent,
  { fetchMedia = fetchOutboundMedia, signal }: { readonly fetchMedia?: OutboundMediaFetcher; readonly signal?: AbortSignal } = {},
): Promise<SendContent> {
  if (!Array.isArray(content)) {
    const [single] = await fetchIcqqRemoteMediaList([content as MessageSegment | string], fetchMedia, signal);
    return single as SendContent;
  }
  return await fetchIcqqRemoteMediaList(content as Array<MessageSegment | string>, fetchMedia, signal) as SendContent;
}

async function fetchIcqqRemoteMediaList(
  segments: Array<MessageSegment | string>,
  fetchMedia: OutboundMediaFetcher,
  signal: AbortSignal | undefined,
): Promise<Array<MessageSegment | string>> {
  const out: Array<MessageSegment | string> = [];
  for (const seg of segments) {
    if (typeof seg === "string" || !seg || typeof seg !== "object") { out.push(seg); continue; }
    const { type, data } = seg as MessageSegment;
    const d = (data ?? {}) as Record<string, unknown>;
    const media = d.media;
    if (!REMOTE_MEDIA_TYPES.has(type) || !isMediaRef(media) || !/^https?:\/\//iu.test(media.value) || media.kind === "base64") {
      out.push(seg);
      continue;
    }
    try {
      const fetched = await fetchMedia(media.value, { ...(signal ? { signal } : {}), source: "icqq" });
      const mime = media.mime_type ?? fetched.mimeType;
      out.push({
        type,
        data: { ...d, media: { ...media, kind: "base64", value: fetched.bytes.toString("base64"), ...(mime ? { mime_type: mime } : {}) } },
      } as MessageSegment);
    } catch (error) {
      if (!isOutboundMediaRefused(error)) throw error;
      out.push({ type: "text", data: { text: outboundMediaNotice(type) } } as MessageSegment);
    }
  }
  return out;
}
