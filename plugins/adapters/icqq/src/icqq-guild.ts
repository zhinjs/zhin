/**
 * ICQQ guild (QQ 频道) catalog sync, inbound normalize, Console channel list.
 */
import { toCanonicalSegments, type MessageSegment } from "zhin.js";
import type { GuildMessageEventData } from "./protocol.js";
import { parseCqMessage } from "./cq-message.js";

export interface IcqqGuildClient {
  getGuildList(): Array<{ guild_id: string; guild_name: string }>;
  getChannelList(guildId: string): Array<{ guild_id: string; channel_id: string; channel_name: string }>;
}

export interface IcqqGuildChannelEntry {
  channel_id: string;
  channel_name: string;
  guild_id: string;
  guild_name: string;
}

export interface NormalizedIcqqGuildInbound {
  messageId: string;
  channelId: string;
  guildId: string;
  guildName: string;
  channelName: string;
  userId: string;
  nickname: string;
  content: MessageSegment[];
  rawMessage: string;
  timestampMs: number;
  raw: GuildMessageEventData;
}

export class IcqqGuildCatalog {
  private readonly channels = new Map<string, IcqqGuildChannelEntry>();
  private readonly guilds = new Map<string, { guild_id: string; guild_name: string }>();

  clear(): void {
    this.channels.clear();
    this.guilds.clear();
  }

  async syncAll(client: IcqqGuildClient): Promise<void> {
    const guildRows = client.getGuildList();
    for (const row of guildRows) {
      const guild_id = String(row.guild_id ?? "");
      if (!guild_id) continue;
      const guild_name = String(row.guild_name ?? guild_id);
      this.guilds.set(guild_id, { guild_id, guild_name });

      const channels = client.getChannelList(guild_id);
      for (const ch of channels) {
        const channel_id = String(ch.channel_id ?? "");
        if (!channel_id) continue;
        const channel_name = String(ch.channel_name ?? channel_id);
        this.channels.set(channel_id, {
          channel_id,
          channel_name,
          guild_id,
          guild_name,
        });
      }
    }
  }

  upsertFromInbound(data: GuildMessageEventData): void {
    const guild_id = String(data.guild_id ?? "");
    const channel_id = String(data.channel_id ?? "");
    if (!guild_id || !channel_id) return;
    const guild_name = String(data.guild_name ?? guild_id);
    const channel_name = String(data.channel_name ?? channel_id);
    this.guilds.set(guild_id, { guild_id, guild_name });
    this.channels.set(channel_id, {
      channel_id,
      channel_name,
      guild_id,
      guild_name,
    });
  }

  getGuildChannelList(): Array<{
    id: string;
    name: string;
    parent: { type: "guild"; id: string; name: string };
  }> {
    return Array.from(this.channels.values()).map((entry) => ({
      id: entry.channel_id,
      name: entry.channel_name,
      parent: {
        type: "guild" as const,
        id: entry.guild_id,
        name: entry.guild_name,
      },
    }));
  }

  resolveConsoleChannelNames(
    channelId: string,
    guildId?: string,
  ): { channelName?: string; parentName?: string } {
    const entry = this.channels.get(channelId);
    if (entry) {
      return { channelName: entry.channel_name, parentName: entry.guild_name };
    }
    if (guildId) {
      const guild = this.guilds.get(guildId);
      return guild ? { parentName: guild.guild_name } : {};
    }
    return {};
  }
}

export function isIcqqGuildEvent(eventName: string | undefined): boolean {
  return typeof eventName === "string" && eventName.startsWith("message.guild");
}

export function normalizeIcqqGuildInboundMessage(
  data: GuildMessageEventData & Record<string, unknown>,
): NormalizedIcqqGuildInbound | null {
  if (data.type !== "guild") return null;
  const guildId = String(data.guild_id ?? "");
  const channelId = String(data.channel_id ?? "");
  if (!guildId || !channelId) return null;

  const userId = String(data.tiny_id ?? data.user_id ?? "");
  const nickname = String(data.nickname ?? userId);
  const rawMessage = String(data.raw_message ?? "");
  const timestampMs =
    typeof data.time === "number" ? data.time * 1000 : Date.now();
  const messageId =
    data.message_id != null && String(data.message_id) !== ""
      ? String(data.message_id)
      : data.seq != null
        ? String(data.seq)
        : `${data.time ?? 0}_${userId}_${channelId}`;

  const parsed = parseCqMessage(rawMessage);
  const canonical = toCanonicalSegments(parsed);
  const content: MessageSegment[] = canonical.length > 0 ? canonical : [{ type: "text", data: { text: rawMessage } }];

  return {
    messageId,
    channelId,
    guildId,
    guildName: String(data.guild_name ?? guildId),
    channelName: String(data.channel_name ?? channelId),
    userId,
    nickname,
    content,
    rawMessage,
    timestampMs,
    raw: data,
  };
}
