/**
 * 将 core keyboard 段转为 qq-official-bot 可识别的 button / markdown 段。
 * @see https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html
 */
import type { ButtonData, KeyboardSegmentData } from "zhin.js";
import type { MessageSegment, SendContent } from "zhin.js";
import { isKeyboardSegment, KeyboardSegment } from "zhin.js";

function asKeyboardData(item: unknown): KeyboardSegmentData | null {
  if (item instanceof KeyboardSegment) return item.data;
  if (item != null && typeof item === "object" && isKeyboardSegment(item as MessageSegment)) {
    return (item as MessageSegment).data as KeyboardSegmentData;
  }
  return null;
}

type QqButton = {
  id: string;
  render_data: { label: string; visited_label: string; style: number };
  action: {
    type: number;
    permission: { type: number };
    data: string;
    click_limit: number;
    unsupport_tips: string;
    enter?: boolean;
    reply?: boolean;
  };
};

function coreButtonToQq(btn: ButtonData): QqButton {
  const isCommand = btn.mode === 'command';
  const action: QqButton['action'] = {
    type: isCommand ? 2 : 1,
    permission: { type: 2 },
    data: btn.payload,
    click_limit: btn.disabled ? 0 : 10,
    unsupport_tips: btn.disabled ? "该按钮不可用" : "",
  };
  if (isCommand) {
    if (btn.command?.enter != null) action.enter = btn.command.enter;
    if (btn.command?.reply != null) action.reply = btn.command.reply;
  }
  return {
    id: btn.id,
    render_data: {
      label: btn.label,
      visited_label: btn.label,
      style: 0,
    },
    action,
  };
}

function keyboardDataToQqSegments(data: KeyboardSegmentData): MessageSegment[] {
  const out: MessageSegment[] = [];
  for (const row of data.rows) {
    out.push({
      type: "button",
      data: {
        buttons: row.map(coreButtonToQq),
      },
    } as MessageSegment);
  }
  return out;
}

/** QQ 官方出站：keyboard → button 行；前置 text 合并为 markdown（按钮消息需带 markdown） */
export function expandKeyboardSegmentsForQq(content: SendContent): SendContent {
  const items = Array.isArray(content) ? content : [content];
  const out: (string | MessageSegment)[] = [];
  const textParts: string[] = [];

  for (const item of items) {
    if (typeof item === "string") {
      textParts.push(item);
      continue;
    }
    const keyboardData = asKeyboardData(item);
    if (keyboardData) {
      if (textParts.length > 0) {
        out.push({
          type: "markdown",
          data: { content: textParts.join("\n") },
        } as MessageSegment);
        textParts.length = 0;
      }
      out.push(...keyboardDataToQqSegments(keyboardData));
      continue;
    }

    if (item.type === "text") {
      const t = item.data?.text ?? item.data?.content ?? "";
      if (t) textParts.push(String(t));
      continue;
    }

    if (textParts.length > 0) {
      out.push({
        type: "markdown",
        data: { content: textParts.join("\n") },
      } as MessageSegment);
      textParts.length = 0;
    }
    out.push(item as MessageSegment);
  }

  if (textParts.length > 0) {
    out.push({
      type: "markdown",
      data: { content: textParts.join("\n") },
    } as MessageSegment);
  }

  if (out.length === 0) return { type: "text", data: { text: "" } };
  if (out.length === 1) return out[0]!;
  return out;
}
