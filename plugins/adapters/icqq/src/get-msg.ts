import type { QuotedMessagePayload } from "zhin.js";
import { parseCqMessage } from "./cq-message.js";
import { extractForwardResidFromGetMsg } from "./forward-msg.js";
import {
  icqqElementsToSegments,
  type IcqqMessageElement,
} from "./icqq-inbound.js";

export function parseIcqqGetMsgResponse(
  messageId: string,
  data: unknown,
): QuotedMessagePayload {
  const record =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};
  let content: QuotedMessagePayload["content"] = [];
  if (Array.isArray(record.message)) {
    content =
      icqqElementsToSegments(record.message as IcqqMessageElement[]) ?? [];
  } else if (typeof record.raw_message === "string" && record.raw_message) {
    content = parseCqMessage(record.raw_message);
  } else if (typeof record.message === "string" && record.message) {
    content = parseCqMessage(record.message);
  }

  const forwardResid = extractForwardResidFromGetMsg(record);
  if (forwardResid && Array.isArray(content)) {
    const hasForward = content.some((s) => s.type === "forward");
    if (!hasForward) {
      content = [
        { type: "forward", data: { id: forwardResid, resid: forwardResid } },
        ...content,
      ];
    }
  }

  const senderRaw = record.sender;
  let sender: QuotedMessagePayload["sender"];
  if (senderRaw && typeof senderRaw === "object") {
    const s = senderRaw as Record<string, unknown>;
    sender = {
      id: String(s.user_id ?? s.uid ?? s.uin ?? ""),
      name: String(s.nickname ?? s.name ?? ""),
    };
  }

  return {
    messageId,
    sender,
    content,
    raw:
      typeof record.raw_message === "string" ? record.raw_message : undefined,
    time: typeof record.time === "number" ? record.time : undefined,
  };
}
