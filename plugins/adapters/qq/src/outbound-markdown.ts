/**
 * 将 AI 出站纯文本段合并为 QQ Markdown 消息（msg_type=2）。
 * 官方已开放全量 Markdown，避免 **bold** 等语法以纯文本展示。
 */
import { segment, type MessageElement, type MessageSegment, type SendContent } from "zhin.js";

function isMessageSegment(seg: MessageElement): seg is MessageSegment {
  return typeof seg.type === "string";
}

export type OutboundMarkdownMode = boolean | "auto";

/** 常见 AI Markdown 输出特征（auto 模式） */
const MARKDOWN_HINT =
  /(?:\*\*|__|`|\[.+\]\(.+\)|^#{1,6}\s|^>\s|^\s*[-*+]\s|^```|\|.+\|)/m;

const BODY_RICH_TYPES = new Set([
  "image",
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

function textSegment(text: string): MessageSegment {
  return { type: "text", data: { text } };
}

function asSegments(content: SendContent): MessageSegment[] {
  if (typeof content === "string") return [textSegment(content)];
  if (!Array.isArray(content)) {
    return isMessageSegment(content) ? [content] : [];
  }
  return content.flatMap((item) =>
    typeof item === "string" ? [textSegment(item)] : isMessageSegment(item) ? [item] : [],
  );
}

function textFromSegment(seg: MessageSegment): string {
  if (seg.type !== "text") return "";
  return seg.data.text ?? seg.data.content ?? "";
}

function shouldConvert(mode: OutboundMarkdownMode | undefined, bodyText: string): boolean {
  if (mode === false) return false;
  if (mode === true) return bodyText.trim().length > 0;
  return MARKDOWN_HINT.test(bodyText);
}

/**
 * 出站归一化：保留 leading `reply`，将连续 text 合并为单条 markdown 段。
 * 含图片/文件等富媒体时原样返回，避免破坏分条发送。
 */
export function normalizeOutboundMarkdown(
  content: SendContent,
  mode: OutboundMarkdownMode | undefined = "auto",
): SendContent {
  const segments = asSegments(content);
  if (segments.length === 0) return content;

  const prefix: MessageSegment[] = [];
  let i = 0;
  while (i < segments.length && segments[i].type === "reply") {
    prefix.push(segments[i]);
    i++;
  }

  const body = segments.slice(i);
  if (body.length === 0) return content;

  if (body.some((seg) => BODY_RICH_TYPES.has(seg.type))) {
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

  if (!shouldConvert(mode, merged)) return content;

  return [...prefix, segment("markdown", { content: merged })];
}
