/**
 * Zhin 消息段 → kook-client Sendable。
 * 图片/音视频须用 segment 发送对应 msg_type，不能写成 Markdown ![alt](url)。
 */
import { segment, type MessageSegment as KookMessageSegment } from "kook-client";
import type { MessageElement } from "zhin.js";
import { coreKeyboardToKookCard, findKeyboardSegment } from "./outbound-keyboard.js";

export type KookSendable = string | KookMessageSegment[] | Array<Record<string, unknown>>;

function mediaUrl(data: Record<string, unknown>): string {
  return String(data.url ?? data.file ?? "");
}

/**
 * 单张图片（可带 reply）→ kook image 消息段（type=2）
 */
export function convertToKookSendable(
  elements: MessageElement[],
  formatText: (content: MessageElement[]) => string,
): KookSendable {
  const keyboardBundle = findKeyboardSegment(elements);
  if (keyboardBundle) {
    const { keyboard, rest } = keyboardBundle;
    const nonReplyRest = rest.filter((el) => el.type !== "reply");
    if (nonReplyRest.every((el) => el.type === "text" || el.type === "reply")) {
      return coreKeyboardToKookCard(keyboard.data, nonReplyRest.filter((el) => el.type === "text"));
    }
  }

  const replies: string[] = [];
  const images: string[] = [];
  const videos: string[] = [];
  const audios: string[] = [];
  const rest: MessageElement[] = [];

  for (const el of elements) {
    if (el.type === "reply" && el.data.id) {
      replies.push(String(el.data.id));
      continue;
    }
    if (el.type === "image") {
      const url = mediaUrl(el.data as Record<string, unknown>);
      if (url) images.push(url);
      continue;
    }
    if (el.type === "video") {
      const url = mediaUrl(el.data as Record<string, unknown>);
      if (url) videos.push(url);
      continue;
    }
    if (el.type === "audio") {
      const url = mediaUrl(el.data as Record<string, unknown>);
      if (url) audios.push(url);
      continue;
    }
    rest.push(el);
  }

  const replySegs = replies.map((id) => segment.reply(id));

  if (images.length === 1 && videos.length === 0 && audios.length === 0 && rest.length === 0) {
    return [...replySegs, segment.image(images[0])];
  }
  if (videos.length === 1 && images.length === 0 && audios.length === 0 && rest.length === 0) {
    return [...replySegs, segment.video(videos[0])];
  }
  if (audios.length === 1 && images.length === 0 && videos.length === 0 && rest.length === 0) {
    return [...replySegs, segment.audio(audios[0])];
  }

  return formatText(elements);
}
