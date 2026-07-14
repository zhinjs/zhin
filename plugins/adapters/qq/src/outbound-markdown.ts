/**
 * 将 AI 出站纯文本段合并为 QQ Markdown 消息（msg_type=2）。
 * 图文混排时合并为单条 Markdown（图片语法见 QQ 官方文档）。
 */
import { segment, type MessageElement, type MessageSegment, type SendContent } from "zhin.js";
import { resolveMediaFile } from "./outbound-media.js";

function isMessageSegment(seg: MessageElement): seg is MessageSegment {
  return typeof seg.type === "string";
}

export type OutboundMarkdownMode = boolean | "auto";

const BLOCKING_RICH_TYPES = new Set([
  "audio",
  "video",
  "file",
  "markdown",
  "ark",
  "embed",
  "keyboard",
  "button",
  "face",
]);

const TEXT_IMAGE_MIX_TYPES = new Set(["text", "at", "image"]);

function textSegment(text: string): MessageSegment {
  return { type: "text", data: { text } };
}

export function asOutboundSegments(content: SendContent): MessageSegment[] {
  if (typeof content === "string") return [textSegment(content)];
  if (!Array.isArray(content)) {
    return isMessageSegment(content) ? [content] : [];
  }
  return content.flatMap((item) =>
    typeof item === "string" ? [textSegment(item)] : isMessageSegment(item) ? [item] : [],
  );
}

export function splitReplyPrefix(segments: MessageSegment[]): {
  prefix: MessageSegment[];
  body: MessageSegment[];
} {
  const prefix: MessageSegment[] = [];
  let i = 0;
  while (i < segments.length && segments[i].type === "reply") {
    prefix.push(segments[i]);
    i++;
  }
  return { prefix, body: segments.slice(i) };
}

function textFromSegment(seg: MessageSegment): string {
  if (seg.type !== "text") return "";
  return seg.data.text ?? seg.data.content ?? "";
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isInlineMedia(value: string): boolean {
  return value.startsWith("base64://")
    || /^data:[^/]+\/[^;]+;base64,/i.test(value)
    || value.startsWith("file://")
    || (value.startsWith("/") && !isRemoteUrl(value));
}

/** QQ Markdown 图片语法：![说明 #宽 #高](公网 URL) */
export function formatQqMarkdownImage(
  url: string,
  data: Record<string, unknown> = {},
): string {
  const width = typeof data.width === "number" && data.width > 0 ? data.width : 200;
  const height = typeof data.height === "number" && data.height > 0 ? data.height : width;
  const label = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "图片";
  return `![${label} #${width}px #${height}px](${url})`;
}

/** 将 image 段解析为 Markdown 可嵌入的 URL（https 或 data URI） */
export function resolveImageMarkdownUrl(data: Record<string, unknown>): string | null {
  const url = typeof data.url === "string" ? data.url : undefined;
  const file = resolveMediaFile(data);

  if (url && isRemoteUrl(url)) return url;
  if (file && isRemoteUrl(file)) return file;

  const inline = file ?? (url && isInlineMedia(url) ? url : undefined);
  if (!inline) return null;

  if (inline.startsWith("base64://")) {
    return `data:image/png;base64,${inline.slice(9)}`;
  }
  if (/^data:[^/]+\/[^;]+;base64,/i.test(inline)) {
    return inline;
  }
  return null;
}

export function isTextImageMixedBody(body: MessageSegment[]): boolean {
  if (body.length === 0) return false;
  if (body.some((seg) => !TEXT_IMAGE_MIX_TYPES.has(seg.type))) return false;
  const hasImage = body.some((seg) => seg.type === "image");
  const hasText = body.some((seg) => seg.type === "text" || seg.type === "at");
  return hasImage && hasText;
}

/** 图文混排且含 base64/本地图（无法直接嵌入 Markdown 公网 URL） */
export function isTextImageMixedWithInlineMedia(body: MessageSegment[]): boolean {
  if (!isTextImageMixedBody(body)) return false;
  return body.some((seg) => {
    if (seg.type !== "image") return false;
    const url = typeof seg.data.url === "string" ? seg.data.url : undefined;
    const file = resolveMediaFile(seg.data);
    if (url && isRemoteUrl(url)) return false;
    if (file && isRemoteUrl(file)) return false;
    return Boolean(resolveMediaFile(seg.data) || (url && isInlineMedia(url)));
  });
}

function segmentToMarkdownPart(seg: MessageSegment): string {
  if (seg.type === "text") return textFromSegment(seg);
  if (seg.type === "at") return `<@${String(seg.data.user_id ?? "")}>`;
  if (seg.type === "image") {
    const src = resolveImageMarkdownUrl(seg.data);
    return src ? formatQqMarkdownImage(src, seg.data) : "";
  }
  return "";
}

function shouldConvertTextOnly(mode: OutboundMarkdownMode | undefined, bodyText: string): boolean {
  if (mode === false) return false;
  if (mode === true) return bodyText.trim().length > 0;
  return hasMarkdownHint(bodyText);
}

function hasMarkdownHint(text: string): boolean {
  if (text.includes('**') || text.includes('__') || text.includes('`')) return true;
  if (text.includes('](') || text.includes('|')) return true;
  return text.split('\n').some((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith('# ') || trimmed.startsWith('## ')
      || trimmed.startsWith('> ')
      || trimmed.startsWith('- ')
      || trimmed.startsWith('* ')
      || trimmed.startsWith('+ ');
  });
}

function mergeTextImageToMarkdown(
  prefix: MessageSegment[],
  body: MessageSegment[],
): SendContent | null {
  if (body.some((seg) => seg.type === "image" && !resolveImageMarkdownUrl(seg.data))) {
    return null;
  }
  const merged = body.map(segmentToMarkdownPart).join("");
  if (!merged.trim()) return null;
  return [...prefix, segment("markdown", { content: merged })];
}

/**
 * 出站归一化：保留 leading `reply`，将连续 text 或 text+image 合并为单条 markdown 段。
 * 含内联 base64 图的图文混排须走 outbound-mixed-media（msg_type=7），此处不处理。
 */
export function normalizeOutboundMarkdown(
  content: SendContent,
  mode: OutboundMarkdownMode | undefined = "auto",
): SendContent {
  const segments = asOutboundSegments(content);
  if (segments.length === 0) return content;

  const { prefix, body } = splitReplyPrefix(segments);
  if (body.length === 0) return content;
  if (mode === false) return content;

  if (body.some((seg) => BLOCKING_RICH_TYPES.has(seg.type))) {
    return content;
  }

  if (body.some((seg) => seg.type === "markdown")) {
    return content;
  }

  if (isTextImageMixedBody(body)) {
    if (isTextImageMixedWithInlineMedia(body)) {
      return content;
    }
    const mixed = mergeTextImageToMarkdown(prefix, body);
    return mixed ?? content;
  }

  if (body.some((seg) => seg.type === "image")) {
    return content;
  }

  if (body.some((seg) => seg.type !== "text" && seg.type !== "at")) {
    return content;
  }

  const merged = body
    .map((seg) => (seg.type === "at"
      ? `<@${String(seg.data.user_id ?? "")}>`
      : textFromSegment(seg)))
    .join("");

  if (!shouldConvertTextOnly(mode, merged)) return content;

  return [...prefix, segment("markdown", { content: merged })];
}
