import { describe, it, expect, vi } from "vitest";
import {
  IcqqGuildCatalog,
  isIcqqGuildEvent,
  normalizeIcqqGuildInboundMessage,
  type IcqqGuildClient,
} from "../src/icqq-guild.js";

describe("icqq guild", () => {
  it("detects guild event names", () => {
    expect(isIcqqGuildEvent("message.guild.normal")).toBe(true);
    expect(isIcqqGuildEvent("message.group.normal")).toBe(false);
  });

  it("normalizes guild inbound with parent.guild channel shape", () => {
    const normalized = normalizeIcqqGuildInboundMessage({
      type: "guild",
      guild_id: "650779094005186335",
      guild_name: "Test Guild",
      channel_id: "634415832",
      channel_name: "general",
      nickname: "Alice",
      tiny_id: "123456",
      raw_message: "hello guild",
      time: 1_700_000_000,
      seq: 42,
    });
    expect(normalized).toMatchObject({
      messageId: "42",
      channelId: "634415832",
      guildId: "650779094005186335",
      userId: "123456",
      nickname: "Alice",
      content: [{ type: "text", data: { text: "hello guild" } }],
    });
  });

  it("syncAll builds getGuildChannelList with parent.guild", async () => {
    const catalog = new IcqqGuildCatalog();
    const client: IcqqGuildClient = {
      getGuildList: vi.fn(() => [{ guild_id: "g1", guild_name: "Guild One" }]),
      getChannelList: vi.fn((guildId: string) => {
        expect(guildId).toBe("g1");
        return [{ guild_id: "g1", channel_id: "c1", channel_name: "chat" }];
      }),
    };

    await catalog.syncAll(client);
    expect(catalog.getGuildChannelList()).toEqual([
      {
        id: "c1",
        name: "chat",
        parent: { type: "guild", id: "g1", name: "Guild One" },
      },
    ]);
  });
});
