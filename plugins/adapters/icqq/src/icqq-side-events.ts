/**
 * icqq IPC 非 message 入站：notice / request / meta（对齐 OneBot 与 @icqqjs/icqq EventMap）
 * @see https://icqq.pages.dev/interfaces/EventMap.html
 */
import { Notice, Request, formatCompact } from "zhin.js";
import type { NoticeType } from "zhin.js";
import type { RequestType } from "zhin.js";
import { Actions } from "./protocol.js";
import type { IpcClient } from "./ipc-client.js";

/** OneBot / icqq 守护进程推送的通用事件字段 */
export interface IcqqIpcRawEvent {
  post_type?: string;
  time?: number;
  self_id?: number;
  notice_type?: string;
  request_type?: string;
  sub_type?: string;
  meta_event_type?: string;
  group_id?: number;
  user_id?: number;
  operator_id?: number;
  flag?: string;
  comment?: string;
  [key: string]: unknown;
}

export function resolveIcqqEventPostType(
  data: Record<string, unknown>,
): string | undefined {
  const pt = data.post_type;
  if (typeof pt === "string" && pt !== "") return pt;
  if (data.notice_type != null) return "notice";
  if (data.request_type != null) return "request";
  if (data.meta_event_type != null) return "meta_event";
  return undefined;
}

export function isIcqqNoticePayload(data: unknown): data is IcqqIpcRawEvent {
  if (!data || typeof data !== "object") return false;
  const pt = resolveIcqqEventPostType(data as Record<string, unknown>);
  return pt === "notice" || (typeof pt === "string" && pt.startsWith("notice."));
}

export function isIcqqRequestPayload(data: unknown): data is IcqqIpcRawEvent {
  if (!data || typeof data !== "object") return false;
  const pt = resolveIcqqEventPostType(data as Record<string, unknown>);
  return pt === "request" || (typeof pt === "string" && pt.startsWith("request."));
}

export function isIcqqMetaPayload(data: unknown): data is IcqqIpcRawEvent {
  if (!data || typeof data !== "object") return false;
  const pt = resolveIcqqEventPostType(data as Record<string, unknown>);
  return pt === "meta_event" || (typeof pt === "string" && pt.startsWith("system."));
}

/** 去重用：notice / request 无稳定 id 时组合键 */
export function resolveSideEventDedupeKey(
  data: IcqqIpcRawEvent,
  kind: "notice" | "request" | "meta",
): string {
  if (data.flag != null && String(data.flag) !== "") {
    return `${kind}:${data.flag}`;
  }
  const time = data.time ?? 0;
  const type =
    data.notice_type ?? data.request_type ?? data.meta_event_type ?? kind;
  const scope = data.group_id ?? data.user_id ?? "";
  const sub = data.sub_type ?? "";
  return `${kind}:${time}_${type}_${scope}_${sub}`;
}

const NOTICE_TYPE_MAP: Record<string, NoticeType> = {
  group_increase: "group_member_increase",
  group_decrease: "group_member_decrease",
  group_admin: "group_admin_change",
  group_ban: "group_ban",
  group_recall: "group_recall",
  friend_recall: "friend_recall",
  friend_add: "friend_add",
  group_upload: "group_upload",
  group_sign: "group_sign",
  group_transfer: "group_transfer",
  // icqq EventMap 命名 → Zhin NoticeType
  "group.increase": "group_member_increase",
  "group.decrease": "group_member_decrease",
  "group.admin": "group_admin_change",
  "group.ban": "group_ban",
  "group.recall": "group_recall",
  "friend.increase": "friend_add",
  "friend.decrease": "friend_recall",
  "friend.recall": "friend_recall",
};

function resolveNoticeZhinType(event: IcqqIpcRawEvent): NoticeType {
  const raw = event.notice_type ?? "";
  if (NOTICE_TYPE_MAP[raw]) return NOTICE_TYPE_MAP[raw];
  if (raw === "notify") {
    if (event.sub_type === "poke") {
      return event.group_id != null ? "group_poke" : "friend_poke";
    }
    return `notify_${event.sub_type ?? "unknown"}` as NoticeType;
  }
  if (raw.startsWith("notice.")) {
    const suffix = raw.slice("notice.".length).replace(/\./g, "_");
    return (NOTICE_TYPE_MAP[suffix] ?? suffix) as NoticeType;
  }
  return raw as NoticeType;
}

function senderFromId(id: unknown, name?: string) {
  if (id == null) return undefined;
  const s = String(id);
  return { id: s, name: name ?? s };
}

export function formatIcqqNotice(
  event: IcqqIpcRawEvent,
  endpointName: string,
): ReturnType<typeof Notice.from<IcqqIpcRawEvent>> {
  const $type = resolveNoticeZhinType(event);
  const isGroup = event.group_id != null;
  const channelId = String(
    event.group_id ?? event.user_id ?? event.operator_id ?? "",
  );
  const tsSec = event.time ?? Math.floor(Date.now() / 1000);

  return Notice.from(event, {
    $id: resolveSideEventDedupeKey(event, "notice"),
    $adapter: "icqq",
    $endpoint: endpointName,
    $type,
    $subType: event.sub_type,
    $channel: {
      id: channelId,
      type: isGroup ? "group" : "private",
    },
    $operator: senderFromId(event.operator_id),
    $target: senderFromId(event.user_id),
    $timestamp: tsSec * 1000,
  });
}

function resolveRequestZhinType(event: IcqqIpcRawEvent): RequestType {
  const rt = event.request_type ?? "";
  if (rt === "friend" || rt.startsWith("friend")) return "friend_add";
  if (rt === "group" || rt.startsWith("group")) {
    return event.sub_type === "invite" ? "group_invite" : "group_add";
  }
  return rt as RequestType;
}

export function formatIcqqRequest(
  event: IcqqIpcRawEvent,
  endpointName: string,
  ipc: IpcClient,
): ReturnType<typeof Request.from<IcqqIpcRawEvent>> {
  const $type = resolveRequestZhinType(event);
  const isGroup = event.group_id != null;
  const channelId = String(event.group_id ?? event.user_id ?? "");
  const tsSec = event.time ?? Math.floor(Date.now() / 1000);
  const flag = event.flag ?? resolveSideEventDedupeKey(event, "request");

  const isFriend =
    event.request_type === "friend" ||
    (typeof event.request_type === "string" &&
      event.request_type.startsWith("friend"));

  return Request.from(event, {
    $id: String(flag),
    $adapter: "icqq",
    $endpoint: endpointName,
    $type,
    $subType: event.sub_type,
    $channel: {
      id: channelId,
      type: isGroup ? "group" : "private",
    },
    $sender: senderFromId(event.user_id) ?? { id: "", name: "" },
    $comment: event.comment,
    $timestamp: tsSec * 1000,
    $approve: async (remark?: string) => {
      const action = isFriend
        ? Actions.HANDLE_FRIEND_REQUEST
        : Actions.HANDLE_GROUP_REQUEST;
      const params: Record<string, unknown> = {
        flag: event.flag ?? flag,
        approve: true,
      };
      if (remark) params.remark = remark;
      if (!isFriend && event.sub_type) params.sub_type = event.sub_type;
      const resp = await ipc.request(action, params);
      if (!resp.ok) throw new Error(resp.error ?? "同意请求失败");
    },
    $reject: async (reason?: string) => {
      const action = isFriend
        ? Actions.HANDLE_FRIEND_REQUEST
        : Actions.HANDLE_GROUP_REQUEST;
      const params: Record<string, unknown> = {
        flag: event.flag ?? flag,
        approve: false,
      };
      if (reason) params.reason = reason;
      if (!isFriend && event.sub_type) params.sub_type = event.sub_type;
      const resp = await ipc.request(action, params);
      if (!resp.ok) throw new Error(resp.error ?? "拒绝请求失败");
    },
  });
}

/** meta_event / system.*：返回是否建议在上线后刷新好友/群列表 */
export function shouldRefreshListsOnMeta(event: IcqqIpcRawEvent): boolean {
  if (event.meta_event_type === "lifecycle") {
    const sub = event.sub_type;
    return sub === "connect" || sub === "enable";
  }
  const pt = event.post_type ?? "";
  if (pt === "system.online" || pt.endsWith(".online")) return true;
  return false;
}

export function formatIcqqMetaLog(event: IcqqIpcRawEvent): string {
  return formatCompact({
    meta: event.meta_event_type ?? event.post_type ?? "meta",
    sub_type: event.sub_type,
    time: event.time,
  });
}
