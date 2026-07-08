import { describe, it, expect } from "vitest";
import {
  InboundMessageDeduper,
  icqqElementsToSegments,
  isIcqqGroupTempPrivateMessage,
  isIcqqMessagePostType,
  normalizeIcqqInboundMessage,
  resolveChannelFromIcqqMessage,
  resolveIcqqInboundMessageId,
  resolveInboundContent,
  resolveIcqqQuoteIdFromEvent,
  findIcqqNestedMessageSource,
  resolveQuoteIdFromIcqqSource,
  quotedPayloadFromIcqqSource,
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

describe("IcqqMessageEvent.source", () => {
  it("resolveQuoteIdFromIcqqSource 读取 message_id", () => {
    expect(
      resolveQuoteIdFromIcqqSource({
        message_id: "YunIUgAArBE+Jdi2ahlnsgA=",
        time: 100,
        seq: 1,
      }),
    ).toBe("YunIUgAArBE+Jdi2ahlnsgA=");
  });

  it("resolveIcqqQuoteIdFromEvent 优先 source", () => {
    expect(
      resolveIcqqQuoteIdFromEvent({
        post_type: "message",
        user_id: 1,
        time: 100,
        message_type: "group",
        source: { message_id: "quoted-id-1" },
      } as any),
    ).toBe("quoted-id-1");
  });

  it("findIcqqNestedMessageSource 从嵌套 data 找到 source", () => {
    const nested = {
      post_type: "message",
      message_type: "group",
      group_id: 1,
      user_id: 2,
      time: 1,
      data: {
        detail: {
          source: {
            message_id: "nested-quote-id",
            raw_message: "被引用的图",
            message: [{ type: "image", url: "https://example.com/a.jpg" }],
          },
        },
      },
    };
    expect(findIcqqNestedMessageSource(nested)?.message_id).toBe(
      "nested-quote-id",
    );
    expect(resolveIcqqQuoteIdFromEvent(nested as any)).toBe("nested-quote-id");
  });

  it("NT source 仅有 seq/rand + 字符串 message 时仍可解析引用", () => {
    const source = {
      user_id: 8596238,
      time: 1780306134,
      seq: 6127,
      rand: 1260414771,
      message: "抱歉，我无法查看您发送的图片。",
    };
    expect(resolveQuoteIdFromIcqqSource(source)).toBe("6127:1260414771");
    const p = quotedPayloadFromIcqqSource(source);
    expect(p?.messageId).toBe("6127:1260414771");
    expect(p?.content).toEqual([
      { type: "text", data: { text: "抱歉，我无法查看您发送的图片。" } },
    ]);
    expect(
      resolveIcqqQuoteIdFromEvent({
        post_type: "message",
        user_id: 1659488338,
        time: 1780306622,
        message_type: "group",
        group_id: 201193925,
        source,
      } as any),
    ).toBe("6127:1260414771");
  });

  it("quotedPayloadFromIcqqSource 解析正文", () => {
    const p = quotedPayloadFromIcqqSource({
      message_id: "q1",
      raw_message: "被引用的文字",
      sender: { user_id: 2, nickname: "Alice" },
    });
    expect(p?.messageId).toBe("q1");
    expect(p?.content).toEqual([
      { type: "text", data: { text: "被引用的文字" } },
    ]);
  });

  it("resolveInboundContent 从 source 补 reply 段", () => {
    const content = resolveInboundContent({
      post_type: "message",
      user_id: 1,
      time: 100,
      message_type: "group",
      group_id: 1,
      message: [{ type: "text", text: "这是什么" }],
      raw_message: "这是什么",
      source: { message_id: "src-msg-id", raw_message: "原消息" },
    } as any);
    expect(content[0].type).toBe("reply");
    expect(content[0].data).toMatchObject({ message_id: "src-msg-id" });
  });
});

describe("resolveInboundContent", () => {
  it("message 段无 reply 时从 raw_message 的 [reply:id] 合并", () => {
    const content = resolveInboundContent({
      post_type: "message",
      user_id: 1,
      time: 100,
      message_type: "group",
      group_id: 860669870,
      message: [
        { type: "at", qq: "907624307" },
        { type: "at", qq: "8596238" },
        { type: "text", text: "这是什么" },
      ],
      raw_message: "[reply:M0zHrrS7mJ0AC8rBcOxj/moZcDUB]@907624307 @8596238 这是什么",
    } as any);
    expect(content[0]).toEqual({
      type: "reply",
      data: {
        message_id: "M0zHrrS7mJ0AC8rBcOxj/moZcDUB",
      },
    });
    expect(content[1]).toEqual({ type: "mention", data: { target: "907624307" } });
    expect(content[2]).toEqual({ type: "mention", data: { target: "8596238" } });
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
    expect(n?.senderRole).toBeUndefined();
    expect(n?.content).toEqual([{ type: "text", data: { text: "te" } }]);
  });

  it("群聊 payload 保留 sender.role", () => {
    const n = normalizeIcqqInboundMessage({
      post_type: "message",
      message_id: "C/35xWLpyFIAABgcUEQr0Wof1QkB",
      user_id: 1659488338,
      time: 1780471049,
      message: [{ type: "text", text: "test" }],
      raw_message: "test",
      message_type: "group",
      sender: { user_id: 1659488338, nickname: "归雨", role: "owner" },
      group_id: 201193925,
      self_id: 8596238,
    } as any);
    expect(n?.channelType).toBe("group");
    expect(n?.senderRole).toBe("owner");
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
    ).toEqual([{ type: "at", data: { qq: "8596238", user_id: "8596238", id: "8596238" } }]);
  });
});

describe("group temp session", () => {
  const groupTempPayload = {
    post_type: "message",
    message_type: "private",
    sub_type: "group",
    user_id: 1659488338,
    from_id: 1659488338,
    time: 1780049842,
    raw_message: "群临时会话 hi",
    message: [{ type: "text", text: "群临时会话 hi" }],
    sender: { user_id: 1659488338, nickname: "成员A", group_id: 123456789 },
    self_id: 8596238,
  } as const;

  it("isIcqqGroupTempPrivateMessage 识别 sub_type=group", () => {
    expect(isIcqqGroupTempPrivateMessage(groupTempPayload)).toBe(true);
    expect(isIcqqGroupTempPrivateMessage(ntPrivatePayload)).toBe(false);
  });

  it("resolveChannelFromIcqqMessage 映射为 private + parent.group", () => {
    expect(resolveChannelFromIcqqMessage(groupTempPayload)).toEqual({
      channelType: "private",
      channelId: "1659488338",
      channelParentGroupId: "123456789",
    });
  });

  it("normalizeIcqqInboundMessage 保留 parent 群上下文", () => {
    const normalized = normalizeIcqqInboundMessage(groupTempPayload as any);
    expect(normalized?.channelType).toBe("private");
    expect(normalized?.channelId).toBe("1659488338");
    expect(normalized?.channelParentGroupId).toBe("123456789");
  });
});
