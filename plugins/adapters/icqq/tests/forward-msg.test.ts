import { describe, expect, it } from "vitest";
import {
  extractForwardResidDeep,
  extractForwardResidFromGetMsg,
  extractForwardResidFromJsonElement,
  formatForwardMsgResponse,
  isForwardPlaceholderPayload,
} from "../src/forward-msg.js";

describe("forward-msg", () => {
  it("extractForwardResidFromJsonElement reads multimsg resid", () => {
    const resid = extractForwardResidFromJsonElement({
      type: "json",
      data: {
        app: "com.tencent.multimsg",
        meta: {
          detail: {
            resid: "B3E5A2F1-0000-0000-ABCD-1234567890AB",
          },
        },
      },
    });
    expect(resid).toBe("B3E5A2F1-0000-0000-ABCD-1234567890AB");
  });

  it("formatForwardMsgResponse formats messages array", () => {
    const text = formatForwardMsgResponse({
      messages: [
        {
          sender: { nickname: "Alice", user_id: 111 },
          time: 1780306187,
          message: [{ type: "text", text: "第一条" }],
        },
        {
          sender: { user_id: 1751271104 },
          message: "第二条纯文本",
        },
      ],
    });
    expect(text).toContain("Alice");
    expect(text).toContain("第一条");
    expect(text).toContain("第二条纯文本");
    expect(text).toContain("1751271104");
  });

  it("isForwardPlaceholderPayload detects chat record placeholder", () => {
    expect(
      isForwardPlaceholderPayload({
        messageId: "m1",
        content: [{ type: "text", data: { text: "[聊天记录]" } }],
      }),
    ).toBe(true);
  });

  it("extractForwardResidFromGetMsg reads resid from message json element", () => {
    expect(
      extractForwardResidFromGetMsg({
        message: [
          {
            type: "json",
            data: {
              app: "com.tencent.multimsg",
              meta: { detail: { resid: "GET-MSG-RESID-1" } },
            },
          },
        ],
        raw_message: "[聊天记录]",
      }),
    ).toBe("GET-MSG-RESID-1");
  });

  it("extractForwardResidFromGetMsg reads resid from raw_message CQ:json", () => {
    const payload = JSON.stringify({
      app: "com.tencent.multimsg",
      meta: { detail: { resid: "RAW-CQ-RESID-2" } },
    });
    expect(
      extractForwardResidFromGetMsg({
        message: [{ type: "text", text: "[聊天记录]" }],
        raw_message: `[CQ:json,data=${payload}]`,
      }),
    ).toBe("RAW-CQ-RESID-2");
  });

  it("extractForwardResidDeep finds resid in nested bytesData", () => {
    const resid = extractForwardResidDeep({
      message: [
        {
          type: "json",
          data: {
            bytesData: JSON.stringify({
              app: "com.tencent.multimsg",
              meta: { detail: { resid: "RESID-NESTED-123" } },
            }),
          },
        },
      ],
    });
    expect(resid).toBe("RESID-NESTED-123");
  });
});
