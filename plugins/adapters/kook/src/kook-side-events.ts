/**
 * KOOK Gateway 非聊天入站：系统消息 (type=255) / BROADCAST → Notice
 * @see https://developer.kookapp.cn/doc/event/event-introduction
 */
import { Notice, formatCompact, type NoticeType } from "zhin.js";

/** KOOK WebSocket s=0 时 d 字段（kook-client Receiver 入参） */
export interface KookGatewayEvent {
  channel_type?: string;
  type?: number;
  target_id?: string;
  author_id?: string;
  content?: string;
  msg_id?: string;
  msg_timestamp?: number;
  nonce?: string;
  extra?: KookGatewayExtra;
  [key: string]: unknown;
}

export interface KookGatewayExtra {
  type?: string;
  body?: Record<string, unknown>;
  guild_id?: string;
  channel_id?: string;
  channel_name?: string;
  author?: { id?: string; username?: string; nickname?: string };
  [key: string]: unknown;
}

const SYSTEM_MESSAGE_TYPE = 255;

/** 是否应由适配器作为 notice 处理（kook-client 对 notice 的 transform 为空实现） */
export function isKookNoticeGatewayEvent(data: unknown): data is KookGatewayEvent {
  if (!data || typeof data !== "object") return false;
  const ev = data as KookGatewayEvent;
  if (ev.type === SYSTEM_MESSAGE_TYPE) return true;
  return ev.channel_type === "BROADCAST";
}

export function resolveKookSideEventDedupeKey(
  event: KookGatewayEvent,
  kind: "notice" | "gateway",
): string {
  if (event.msg_id) return `${kind}:${event.msg_id}`;
  const extra = event.extra ?? {};
  const noticeType = extra.type ?? String(event.type ?? "");
  const scope = event.target_id ?? "";
  const ts = event.msg_timestamp ?? 0;
  return `${kind}:${ts}_${noticeType}_${scope}`;
}

const NOTICE_TYPE_MAP: Record<string, NoticeType> = {
  joined_guild: "group_member_increase",
  exited_guild: "group_member_decrease",
  deleted_message: "group_recall",
  deleted_private_message: "friend_recall",
  added_reaction: "group_emoji_reaction",
  deleted_reaction: "group_emoji_reaction",
  private_added_reaction: "group_emoji_reaction",
  private_deleted_reaction: "group_emoji_reaction",
};

function resolveNoticeZhinType(rawType: string): NoticeType {
  return NOTICE_TYPE_MAP[rawType] ?? rawType;
}

function senderFromId(id: unknown, name?: string) {
  if (id == null || id === "") return undefined;
  const s = String(id);
  return { id: s, name: name ?? s };
}

function readString(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = obj?.[key];
  if (v == null || v === "") return undefined;
  return String(v);
}

/** 解析 notice 发生的频道 / 群 / 私聊 */
export function resolveKookNoticeChannel(
  event: KookGatewayEvent,
): { id: string; type: "group" | "private" | "channel" } {
  const extra = event.extra ?? {};
  const body = extra.body ?? {};
  const rawType = String(extra.type ?? "");

  if (event.channel_type === "BROADCAST") {
    const guildId =
      readString(body, "guild_id")
      ?? extra.guild_id
      ?? event.target_id
      ?? "";
    return { id: guildId, type: "group" };
  }

  if (event.type === SYSTEM_MESSAGE_TYPE && event.channel_type === "GROUP") {
    const guildId =
      readString(body, "guild_id")
      ?? extra.guild_id
      ?? event.target_id
      ?? "";
    if (
      rawType === "joined_guild"
      || rawType === "exited_guild"
      || rawType === "updated_guild"
      || rawType === "deleted_guild"
      || rawType.startsWith("added_role")
      || rawType.startsWith("deleted_role")
      || rawType.startsWith("updated_role")
      || rawType.startsWith("added_block")
      || rawType.startsWith("deleted_block")
      || rawType === "self_joined_guild"
      || rawType === "self_exited_guild"
    ) {
      return { id: guildId, type: "group" };
    }
    const channelId =
      readString(body, "channel_id")
      ?? extra.channel_id
      ?? event.target_id
      ?? "";
    return { id: channelId, type: "channel" };
  }

  if (
    rawType.startsWith("private_")
    || rawType.includes("private_message")
    || event.channel_type === "PERSON"
  ) {
    const userId =
      readString(body, "user_id")
      ?? readString(body, "target_id")
      ?? event.target_id
      ?? event.author_id
      ?? "";
    return { id: userId, type: "private" };
  }

  const channelId =
    readString(body, "channel_id")
    ?? extra.channel_id
    ?? event.target_id
    ?? "";
  return { id: channelId, type: "channel" };
}

export function enrichKookGatewayForPlugins(event: KookGatewayEvent): KookGatewayEvent {
  const extra = event.extra ?? {};
  const noticeType = extra.type;
  if (!isKookNoticeGatewayEvent(event)) {
    return { ...(event as object), post_type: "message" } as KookGatewayEvent;
  }
  return {
    ...(event as object),
    post_type: "notice",
    notice_type: noticeType ?? "system",
  } as KookGatewayEvent;
}

export function formatKookNotice(
  event: KookGatewayEvent,
  botName: string,
): ReturnType<typeof Notice.from<KookGatewayEvent>> {
  const extra = event.extra ?? {};
  const body = extra.body ?? {};
  const rawType = String(extra.type ?? "unknown");
  const $type = resolveNoticeZhinType(rawType);
  const channel = resolveKookNoticeChannel(event);
  const ts = event.msg_timestamp ?? Date.now();

  const targetId =
    readString(body, "user_id")
    ?? readString(body, "msg_id")
    ?? readString(body, "target_id");
  const operatorId =
    readString(body, "operator_id")
    ?? (event.author_id !== "1" ? event.author_id : undefined);

  const mapped = NOTICE_TYPE_MAP[rawType] != null;

  return Notice.from(event, {
    $id: resolveKookSideEventDedupeKey(event, "notice"),
    $adapter: "kook",
    $bot: botName,
    $type,
    $subType: mapped ? rawType : undefined,
    $channel: channel,
    $operator: senderFromId(operatorId),
    $target: senderFromId(targetId),
    $timestamp: ts,
  });
}

export function formatKookNoticeLog(notice: ReturnType<typeof formatKookNotice>): string {
  return formatCompact({
    notice: notice.$type,
    kook_type: notice.$subType,
    channel: `${notice.$channel.type}(${notice.$channel.id})`,
    bot: notice.$bot,
  });
}
