import { describe, it, expect, vi } from "vitest";
import {
  IcqqGuildCatalog,
  isIcqqGuildIpcEvent,
  normalizeIcqqGuildInboundMessage,
} from "../src/icqq-guild.js";
import { Actions } from "../src/protocol.js";

describe("icqq guild", () => {
  it("detects guild IPC event names", () => {
    expect(isIcqqGuildIpcEvent("message.guild.normal")).toBe(true);
    expect(isIcqqGuildIpcEvent("message.group.normal")).toBe(false);
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
    const request = vi.fn(async (action: string, params?: Record<string, unknown>) => {
      if (action === Actions.GUILD_LIST) {
        return {
          ok: true,
          data: [{ guild_id: "g1", guild_name: "Guild One" }],
        };
      }
      if (action === Actions.GUILD_CHANNELS) {
        expect(params?.guild_id).toBe("g1");
        return {
          ok: true,
          data: [{ channel_id: "c1", channel_name: "chat" }],
        };
      }
      return { ok: false };
    });

    await catalog.syncAll({ request } as never);
    expect(catalog.getGuildChannelList()).toEqual([
      {
        id: "c1",
        name: "chat",
        parent: { type: "guild", id: "g1", name: "Guild One" },
      },
    ]);
  });
});
