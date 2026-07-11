/**
 * icqq IPC 非 message 入站：notice / request / meta（对齐 OneBot 与 @icqqjs/icqq EventMap）
 */
import { mapNoticeParts, mapRequestParts, resolveSideEventDedupeKey, senderFromId, buildNotice, buildRequest, formatCompact, type OneBotLikeRawEvent } from 'zhin.js';

import { Actions } from "./protocol.js";
import type { IpcClient } from "./ipc-client.js";

export type IcqqIpcRawEvent = OneBotLikeRawEvent;

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

export function formatIcqqNotice(
  event: IcqqIpcRawEvent,
  endpointName: string,
) {
  const raw = event.notice_type ?? "";
  const isGroup = event.group_id != null;
  const { scene_type, sub_type } = mapNoticeParts('icqq', raw, { sub_type: event.sub_type, is_group: isGroup });
  const sceneId = String(
    event.group_id ?? event.user_id ?? event.operator_id ?? "",
  );
  const tsSec = event.time ?? Math.floor(Date.now() / 1000);

  return buildNotice(event, {
    $id: resolveSideEventDedupeKey(event, "notice"),
    $adapter: "icqq",
    $endpoint: endpointName,
    $type: "notice",
    $scene_id: sceneId,
    $scene_type: scene_type,
    $sub_type: sub_type,
    $actor: senderFromId(event.operator_id),
    $target: senderFromId(event.user_id),
    $timestamp: tsSec * 1000,
  });
}

export function formatIcqqRequest(
  event: IcqqIpcRawEvent,
  endpointName: string,
  ipc: IpcClient,
) {
  const { scene_type, sub_type } = mapRequestParts('icqq', event.request_type ?? '', event.sub_type);
  const sceneId = String(event.group_id ?? event.user_id ?? "");
  const tsSec = event.time ?? Math.floor(Date.now() / 1000);
  const flag = event.flag ?? resolveSideEventDedupeKey(event, "request");

  const isFriend =
    event.request_type === "friend" ||
    (typeof event.request_type === "string" &&
      event.request_type.startsWith("friend"));

  return buildRequest(event, {
    $id: String(flag),
    $adapter: "icqq",
    $endpoint: endpointName,
    $type: "request",
    $scene_id: sceneId,
    $scene_type: scene_type,
    $sub_type: sub_type,
    $actor: senderFromId(event.user_id) ?? { id: "", name: "" },
    $comment: typeof event.comment === "string" ? event.comment : undefined,
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

export function shouldRefreshListsOnMeta(event: IcqqIpcRawEvent): boolean {
  if (event.meta_event_type === "lifecycle") {
    const sub = event.sub_type;
    return sub === "connect" || sub === "enable";
  }
  const pt = String(event.post_type ?? "");
  if (pt === "system.online" || pt.endsWith(".online")) return true;
  return false;
}

export function formatIcqqMetaLog(event: IcqqIpcRawEvent): string {
  const meta =
    (typeof event.meta_event_type === "string" && event.meta_event_type) ||
    (typeof event.post_type === "string" && event.post_type) ||
    "meta";
  const subType = typeof event.sub_type === "string" ? event.sub_type : undefined;
  const time = typeof event.time === "number" ? event.time : undefined;
  return formatCompact({
    meta,
    sub_type: subType,
    time,
  });
}
