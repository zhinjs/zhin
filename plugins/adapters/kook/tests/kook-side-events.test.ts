import { describe, it, expect } from "vitest";
import {
  formatKookNotice,
  isKookNoticeGatewayEvent,
  resolveKookNoticeChannel,
  resolveKookSideEventDedupeKey,
} from "../src/kook-side-events.js";

describe("isKookNoticeGatewayEvent", () => {
  it("识别 type=255 系统消息", () => {
    expect(
      isKookNoticeGatewayEvent({
        channel_type: "GROUP",
        type: 255,
        target_id: "guild-1",
        extra: { type: "joined_guild", body: { user_id: "u1" } },
      }),
    ).toBe(true);
  });

  it("识别 BROADCAST 通道", () => {
    expect(
      isKookNoticeGatewayEvent({
        channel_type: "BROADCAST",
        type: 1,
        target_id: "guild-1",
      }),
    ).toBe(true);
  });

  it("普通聊天消息返回 false", () => {
    expect(
      isKookNoticeGatewayEvent({
        channel_type: "GROUP",
        type: 9,
        target_id: "ch-1",
      }),
    ).toBe(false);
  });
});

describe("formatKookNotice", () => {
  it("joined_guild → group_member_increase", () => {
    const n = formatKookNotice(
      {
        channel_type: "GROUP",
        type: 255,
        target_id: "60163000000000",
        msg_id: "msg-join-1",
        msg_timestamp: 1612774315732,
        extra: {
          type: "joined_guild",
          body: { user_id: "3891000000", joined_at: 1612774315000 },
        },
      },
      "my-bot",
    );
    expect(n.$type).toBe("group_member_increase");
    expect(n.$subType).toBe("joined_guild");
    expect(n.$adapter).toBe("kook");
    expect(n.$channel.type).toBe("group");
    expect(n.$channel.id).toBe("60163000000000");
    expect(n.$target?.id).toBe("3891000000");
  });

  it("deleted_message → group_recall", () => {
    const n = formatKookNotice(
      {
        channel_type: "GROUP",
        type: 255,
        target_id: "ch-001",
        msg_id: "msg-del-1",
        extra: {
          type: "deleted_message",
          guild_id: "guild-1",
          body: { msg_id: "old-msg", user_id: "u9" },
        },
      },
      "bot",
    );
    expect(n.$type).toBe("group_recall");
    expect(n.$channel.type).toBe("channel");
    expect(n.$channel.id).toBe("ch-001");
  });

  it("added_reaction → group_emoji_reaction", () => {
    const n = formatKookNotice(
      {
        channel_type: "GROUP",
        type: 255,
        target_id: "ch-2",
        author_id: "u1",
        extra: {
          type: "added_reaction",
          body: { msg_id: "m1", emoji: "⏳" },
        },
      },
      "bot",
    );
    expect(n.$type).toBe("group_emoji_reaction");
    expect(n.$subType).toBe("added_reaction");
  });
});

describe("resolveKookNoticeChannel", () => {
  it("PERSON 通道系统消息解析为 private", () => {
    const ch = resolveKookNoticeChannel({
      channel_type: "PERSON",
      type: 255,
      target_id: "user-99",
      extra: { type: "guild_member_online", body: { user_id: "user-88" } },
    });
    expect(ch.type).toBe("private");
    // body.user_id 为事件主体（上线用户），target_id 为单播接收方
    expect(ch.id).toBe("user-88");
  });
});

describe("resolveKookSideEventDedupeKey", () => {
  it("优先使用 msg_id", () => {
    expect(
      resolveKookSideEventDedupeKey(
        { msg_id: "abc", type: 255, extra: { type: "joined_guild" } },
        "notice",
      ),
    ).toBe("notice:abc");
  });
});
