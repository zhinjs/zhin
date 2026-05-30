import { describe, it, expect } from "vitest";
import {
  InboundMessageDeduper,
  icqqElementsToSegments,
  isIcqqMessagePostType,
  normalizeIcqqInboundMessage,
  resolveIcqqInboundMessageId,
  shouldSkipSelfInboundMessage,
  unwrapIcqqIpcEventPayload,
} from "../src/icqq-inbound.js";

const ntPrivatePayload = {
  post_type: "message",
  message_id: "YunIUgAArBE+Jdi2ahlnsgA=",
  nt: true,
  user_id: 1659488338,
  time: 1780049842,
  seq: 44049,
  message: [{ type: "text", text: "te" }],
  raw_message: "te",
  message_type: "private",
  sub_type: "friend",
  sender: { user_id: 1659488338, nickname: "归雨" },
  from_id: 1659488338,
  to_id: 8596238,
  self_id: 8596238,
} as const;

describe("isIcqqMessagePostType", () => {
  it("接受 post_type=message", () => {
    expect(isIcqqMessagePostType(ntPrivatePayload)).toBe(true);
  });

  it("忽略非 message 事件", () => {
    expect(isIcqqMessagePostType({ post_type: "notice", time: 1 })).toBe(
      false,
    );
  });

  it("兼容旧版无 post_type 的私聊", () => {
    expect(
      isIcqqMessagePostType({
        type: "private",
        from_id: 1,
        user_id: 2,
        nickname: "u",
        raw_message: "hi",
        time: 100,
      }),
    ).toBe(true);
  });
});

describe("normalizeIcqqInboundMessage", () => {
  it("解析 NT 私聊 payload", () => {
    const n = normalizeIcqqInboundMessage(ntPrivatePayload as any);
    expect(n).toMatchObject({
      messageId: "YunIUgAArBE+Jdi2ahlnsgA=",
      idSource: "message_id",
      channelType: "private",
      channelId: "1659488338",
      userId: "1659488338",
      nickname: "归雨",
    });
    expect(n?.content).toEqual([{ type: "text", data: { text: "te" } }]);
  });
});

describe("resolveIcqqInboundMessageId", () => {
  it("优先 message_id，其次 msg_id", () => {
    expect(
      resolveIcqqInboundMessageId(ntPrivatePayload as any, "1"),
    ).toEqual({ id: "YunIUgAArBE+Jdi2ahlnsgA=", source: "message_id" });

    const withMsgId = {
      ...ntPrivatePayload,
      message_id: undefined,
      msg_id: "72057595080595638",
    };
    expect(resolveIcqqInboundMessageId(withMsgId as any, "1")).toEqual({
      id: "72057595080595638",
      source: "msg_id",
    });
  });
});

describe("InboundMessageDeduper", () => {
  it("同一 message_id 只处理一次", () => {
    const d = new InboundMessageDeduper();
    expect(d.shouldProcess("abc")).toBe(true);
    expect(d.shouldProcess("abc")).toBe(false);
    expect(d.shouldProcess("other")).toBe(true);
  });
});

describe("shouldSkipSelfInboundMessage", () => {
  it("跳过 bot 自己发出的消息", () => {
    expect(
      shouldSkipSelfInboundMessage({
        ...ntPrivatePayload,
        user_id: 8596238,
      } as any),
    ).toBe(true);
  });
});

describe("unwrapIcqqIpcEventPayload", () => {
  it("从 event.data 解包", () => {
    expect(
      unwrapIcqqIpcEventPayload({
        id: "sub",
        event: "message",
        data: ntPrivatePayload,
      }),
    ).toEqual(ntPrivatePayload);
  });

  it("从根级 OneBot 字段解包", () => {
    const flat = { id: "sub", event: "push", ...ntPrivatePayload };
    expect(unwrapIcqqIpcEventPayload(flat as any)).toMatchObject({
      post_type: "message",
      user_id: 1659488338,
    });
  });

  it("仅 from_id 无 user_id 仍视为消息", () => {
    const payload = {
      post_type: "message",
      message_type: "private",
      from_id: 1659488338,
      time: 1780049842,
      message: [{ type: "text", text: "hi" }],
    };
    expect(isIcqqMessagePostType(payload)).toBe(true);
    expect(normalizeIcqqInboundMessage(payload as any)?.userId).toBe(
      "1659488338",
    );
  });
});

describe("icqqElementsToSegments", () => {
  it("解析 at 段", () => {
    expect(
      icqqElementsToSegments([{ type: "at", qq: "8596238" }]),
    ).toEqual([{ type: "at", data: { qq: "8596238" } }]);
  });
});
