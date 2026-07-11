import { describe, it, expect } from "vitest";
import {
  formatKookNotice,
  isKookNoticeGatewayEvent,
  resolveKookNoticeChannel,
  resolveKookSideEventDedupeKey,
} from "../src/kook-side-events.js";
import { formatSideEventName } from "zhin.js";

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
  it("joined_guild → notice.group.member_increase", () => {
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
    expect(formatSideEventName(n)).toBe("notice.group.member_increase");
    expect(n.$type).toBe("notice");
    expect(n.$scene_type).toBe("group");
    expect(n.$sub_type).toBe("member_increase");
    expect(n.$adapter).toBe("kook");
    expect(n.$scene_id).toBe("60163000000000");
    expect(n.$target?.id).toBe("3891000000");
  });

  it("deleted_message → notice.group.recall", () => {
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
      "endpoint",
    );
    expect(formatSideEventName(n)).toBe("notice.group.recall");
    expect(n.$scene_id).toBe("ch-001");
  });

  it("added_reaction → notice.group.emoji_reaction", () => {
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
      "endpoint",
    );
    expect(formatSideEventName(n)).toBe("notice.group.emoji_reaction");
    expect(n.$sub_type).toBe("emoji_reaction");
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
