/**
 * KOOK Gateway 非聊天入站：系统消息 (type=255) / BROADCAST → Notice
 */
import {
  Notice,
  Message,
  mapNoticeParts,
  senderFromId,
  buildNotice,
  formatCompact,
} from "zhin.js";

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

function readString(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = obj?.[key];
  if (v == null || v === "") return undefined;
  return String(v);
}

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
  endpointName: string,
) {
  const extra = event.extra ?? {};
  const body = extra.body ?? {};
  const rawType = String(extra.type ?? "unknown");
  const { scene_type, sub_type } = mapNoticeParts('kook', rawType);
  const channel = resolveKookNoticeChannel(event);
  const ts = event.msg_timestamp ?? Date.now();

  const targetId =
    readString(body, "user_id")
    ?? readString(body, "msg_id")
    ?? readString(body, "target_id");
  const operatorId =
    readString(body, "operator_id")
    ?? (event.author_id !== "1" ? event.author_id : undefined);

  return buildNotice(event, {
    $id: resolveKookSideEventDedupeKey(event, "notice"),
    $adapter: "kook",
    $endpoint: endpointName,
    $type: "notice",
    $scene_id: channel.id,
    $scene_type: scene_type,
    $sub_type: sub_type,
    $actor: senderFromId(operatorId),
    $target: senderFromId(targetId),
    $timestamp: ts,
  });
}

export function formatKookNoticeLog(notice: ReturnType<typeof formatKookNotice>): string {
  return formatCompact({
    notice: `${notice.$type}.${notice.$scene_type}.${notice.$sub_type}`,
    kook_type: notice.$sub_type,
    scene: `${notice.$scene_type}(${notice.$scene_id})`,
    endpoint: notice.$endpoint,
  });
}

export function isKookButtonClickEvent(event: KookGatewayEvent): boolean {
  return event.type === SYSTEM_MESSAGE_TYPE && event.extra?.type === 'message_btn_click';
}

export function formatKookButtonClickMessage(
  event: KookGatewayEvent,
  endpointName: string,
): ReturnType<typeof Message.from<KookGatewayEvent>> {
  const extra = event.extra ?? {};
  const body = extra.body ?? {};
  const payload = String(body.value ?? '');
  const userInfo = body.user_info as { id?: string; username?: string; nickname?: string } | undefined;
  const userId = String(body.user_id ?? userInfo?.id ?? event.author_id ?? '');
  const userName = userInfo?.nickname ?? userInfo?.username ?? userId;
  const sourceMessageId = String(body.msg_id ?? '');

  let channelType: 'private' | 'channel' = 'private';
  let channelId = String(body.target_id ?? event.target_id ?? userId);
  if (body.channel_type === 'GROUP' || event.channel_type === 'GROUP') {
    channelType = 'channel';
    channelId = String(body.target_id ?? event.target_id ?? channelId);
  } else if (body.channel_type === 'PERSON' || event.channel_type === 'PERSON') {
    channelType = 'private';
    channelId = String(body.target_id ?? event.target_id ?? userId);
  }

  return Message.from(event, {
    $id: event.msg_id ?? `btn:${Date.now()}`,
    $adapter: 'kook',
    $endpoint: endpointName,
    $sender: { id: userId, name: userName },
    $channel: { id: channelId, type: channelType },
    $content: [{
      type: 'action',
      data: {
        id: payload,
        payload,
        sourceMessageId,
      },
    }],
    $raw: payload,
    $timestamp: event.msg_timestamp ?? Date.now(),
    $recall: async () => {},
    $reply: async () => '',
  });
}
