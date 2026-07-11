/**
 * 机器人请求/通知：内存 Request 映射 + WS 广播 + 事件注册
 */
import type WebSocket from "ws";
import { broadcastSse } from "./sse-hub.js";
import type { Request as ZhinRequest } from "@zhin.js/core";
import {
  insertRequest,
  insertNotice,
  listUnconsumedRequests,
  listUnconsumedNotices,
  markRequestsConsumed,
  findRequestRow,
  type StoredRequestRow,
  type StoredNoticeRow,
} from "./endpoint-persistence.js";
import { toConsoleChannel, toConsoleChannelParent } from "./endpoint-channel.js";

type WsIterable = { clients?: Set<WebSocket> | WebSocket[] };

let wssRef: WsIterable | null = null;
let hubInited = false;

export function setEndpointHubWss(wss: WsIterable) {
  wssRef = wss;
}

function broadcast(obj: object) {
  broadcastSse(obj as { type: string; data?: unknown });
  const msg = JSON.stringify(obj);
  const clients = wssRef?.clients;
  if (!clients) return;
  const list = clients instanceof Set ? [...clients] : clients;
  for (const ws of list) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function requestMemoryKey(adapter: string, endpointId: string, platformId: string) {
  return `${adapter}:${endpointId}:${platformId}`;
}

const pendingRequestObjects = new Map<string, { req: ZhinRequest; createdAt: number }>();
const PENDING_REQUEST_TTL_MS = 30 * 60 * 1000;

function evictStalePendingRequests(): void {
  const now = Date.now();
  for (const [key, entry] of pendingRequestObjects) {
    if (now - entry.createdAt > PENDING_REQUEST_TTL_MS) {
      pendingRequestObjects.delete(key);
    }
  }
}

export function serializeRequestPush(row: StoredRequestRow, canAct: boolean) {
  return {
    $row_id: row.id,
    $id: row.platform_request_id,
    $adapter: row.adapter,
    $endpoint: row.endpoint_id,
    $type: row.type,
    $scene_id: row.scene_id,
    $scene_type: row.scene_type || undefined,
    $sub_type: row.sub_type || undefined,
    $actor: { id: row.actor_id, name: row.actor_name },
    $comment: row.comment || undefined,
    $timestamp: row.created_at,
    $can_act: canAct,
  };
}

export function serializeNoticePush(row: StoredNoticeRow, notice?: {
  $sub_type?: string;
  $scene_type?: string;
  $actor?: { id?: string; name?: string };
  $target?: { id?: string; name?: string };
}) {
  return {
    $row_id: row.id,
    $id: row.platform_notice_id,
    $adapter: row.adapter,
    $endpoint: row.endpoint_id,
    $type: row.type,
    $scene_id: row.scene_id,
    $scene_type: notice?.$scene_type ?? (row.scene_type || undefined),
    $sub_type: notice?.$sub_type ?? (row.sub_type || undefined),
    $actor: notice?.$actor ?? (row.actor_id
      ? { id: row.actor_id, name: row.actor_name || undefined }
      : undefined),
    $target: notice?.$target ?? (row.target_id
      ? { id: row.target_id, name: row.target_name || undefined }
      : undefined),
    $raw_payload: row.payload,
    $timestamp: row.created_at,
  };
}

export async function storePendingRequest(
  adapter: string,
  endpointId: string,
  req: ZhinRequest
): Promise<StoredRequestRow> {
  const platformId = req.$id;
  const key = requestMemoryKey(adapter, endpointId, platformId);
  evictStalePendingRequests();
  pendingRequestObjects.set(key, { req, createdAt: Date.now() });
  const row = await insertRequest({
    adapter,
    endpoint_id: endpointId,
    platform_request_id: platformId,
    type: String(req.$type),
    scene_type: req.$scene_type != null ? String(req.$scene_type) : "",
    scene_id: String(req.$scene_id ?? ""),
    sub_type: req.$sub_type != null ? String(req.$sub_type) : "",
    actor_id: String(req.$actor?.id ?? ""),
    actor_name: String(req.$actor?.name ?? ""),
    comment: String(req.$comment ?? ""),
    created_at: typeof req.$timestamp === "number" ? req.$timestamp : Date.now(),
  });
  return row;
}

export async function onRequestReceived(adapter: string, endpointId: string, req: ZhinRequest) {
  const row = await storePendingRequest(adapter, endpointId, req);
  const key = requestMemoryKey(adapter, endpointId, req.$id);
  const canAct = pendingRequestObjects.has(key);
  broadcast({ type: "request.receive", data: serializeRequestPush(row, canAct) });
}

export async function onNoticeReceived(adapter: string, endpointId: string, notice: any) {
  let raw: Record<string, unknown> = {};
  try {
    raw = Object.fromEntries(
      Object.entries(notice).filter(
        ([k]) => !k.startsWith("$") && k !== "adapter" && k !== "bot"
      )
    ) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  let payload: string;
  try {
    payload = JSON.stringify({
      type: notice.$type,
      scene_type: notice.$scene_type,
      scene_id: notice.$scene_id,
      sub_type: notice.$sub_type,
      actor: notice.$actor,
      target: notice.$target,
      raw,
    });
  } catch {
    payload = JSON.stringify({ type: notice.$type, error: "serialize_failed" });
  }
  const row = await insertNotice({
    adapter,
    endpoint_id: endpointId,
    platform_notice_id: String(notice.$id ?? ""),
    type: String(notice.$type ?? "unknown"),
    scene_type: String(notice.$scene_type ?? ""),
    scene_id: String(notice.$scene_id ?? ""),
    sub_type: notice.$sub_type != null ? String(notice.$sub_type) : "",
    actor_id: String(notice.$actor?.id ?? ""),
    actor_name: String(notice.$actor?.name ?? ""),
    target_id: String(notice.$target?.id ?? ""),
    target_name: String(notice.$target?.name ?? ""),
    payload,
    created_at: typeof notice.$timestamp === "number" ? notice.$timestamp : Date.now(),
  });
  broadcast({
    type: "notice.receive",
    data: serializeNoticePush(row, {
      $sub_type: notice.$sub_type,
      $scene_type: notice.$scene_type,
      $actor: notice.$actor,
      $target: notice.$target,
    }),
  });
}

export function getPendingRequest(
  adapter: string,
  endpointId: string,
  platformRequestId: string
): ZhinRequest | undefined {
  return pendingRequestObjects.get(requestMemoryKey(adapter, endpointId, platformRequestId))?.req;
}

export function removePendingRequest(adapter: string, endpointId: string, platformRequestId: string) {
  pendingRequestObjects.delete(requestMemoryKey(adapter, endpointId, platformRequestId));
}

export async function markRequestConsumedByPlatformId(
  adapter: string,
  endpointId: string,
  platformRequestId: string
) {
  const row = await findRequestRow(adapter, endpointId, platformRequestId);
  if (row) await markRequestsConsumed([row.id]);
  removePendingRequest(adapter, endpointId, platformRequestId);
}

export async function sendCatchUpToClient(ws: WebSocket) {
  const reqs = await listUnconsumedRequests();
  for (const row of reqs) {
    const canAct = pendingRequestObjects.has(
      requestMemoryKey(row.adapter, row.endpoint_id, row.platform_request_id)
    );
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: "request.receive",
          data: serializeRequestPush(row, canAct),
        })
      );
    }
  }
  const notices = await listUnconsumedNotices();
  for (const row of notices) {
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: "notice.receive",
          data: serializeNoticePush(row),
        })
      );
    }
  }
}

export function initEndpointHub(root: {
  on: (ev: string, fn: (...a: any[]) => void) => void;
  off?: (ev: string, fn: (...a: any[]) => void) => void;
  adapters?: Iterable<string>;
  inject?: (key: string) => unknown;
}): (() => void) | undefined {
  if (hubInited) return;
  hubInited = true;

  const handlerReq = (req: ZhinRequest) => {
    const adapter = String(req.$adapter);
    const endpointId = String(req.$endpoint);
    onRequestReceived(adapter, endpointId, req);
  };
  const handlerNotice = (notice: any) => {
    const adapter = String(notice.$adapter);
    const endpointId = String(notice.$endpoint);
    onNoticeReceived(adapter, endpointId, notice);
  };

  const handlerBotLifecycle = (payload: {
    adapter: string;
    endpointId: string;
    endpoint?: unknown;
    kind: string;
    error?: string;
    phase?: string;
    detail?: Record<string, unknown>;
  }) => {
    broadcast({
      type: "endpoint.lifecycle",
      data: {
        $adapter: payload.adapter,
        $endpoint: payload.endpointId,
        $kind: payload.kind,
        $error: payload.error,
        $phase: payload.phase,
        $detail: payload.detail,
      },
    });
  };

  root.on("request.receive", handlerReq);
  root.on("notice.receive", handlerNotice);
  root.on("endpoint.connect", handlerBotLifecycle);
  root.on("endpoint.disconnect", handlerBotLifecycle);
  root.on("endpoint.error", handlerBotLifecycle);

  const adapterNames = root.adapters ? [...(root.adapters as Iterable<string>)] : [];
  const inject = root.inject;
  const adapterListeners: Array<{ adapter: any; handler: (...a: any[]) => void }> = [];
  if (inject && typeof inject === "function" && adapterNames.length > 0) {
    for (const name of adapterNames) {
      try {
        const ad = inject(name) as { on?: (ev: string, fn: (...a: any[]) => void) => void; off?: (ev: string, fn: (...a: any[]) => void) => void } | null;
        if (ad && typeof ad.on === "function") {
          const handler = (msg: Record<string, unknown>) => {
            const msgChannel = msg?.$channel as {
              id?: string;
              type?: string;
              parent?: { type?: string; id?: string };
            } | undefined;
            let resolvedNames: { channelName?: string; parentName?: string } | undefined;
            try {
              const endpointId = String(msg?.$endpoint ?? "");
              const adFull = inject(name) as {
                endpoints?: Map<string, {
                  resolveConsoleChannelNames?: (
                    channelId: string,
                    guildId?: string,
                  ) => { channelName?: string; parentName?: string };
                }>;
              } | null;
              const ep = adFull?.endpoints?.get(endpointId);
              if (ep?.resolveConsoleChannelNames && msgChannel?.id) {
                resolvedNames = ep.resolveConsoleChannelNames(
                  msgChannel.id,
                  msgChannel.parent?.id,
                );
              }
            } catch {
              // ignore
            }
            const channel = toConsoleChannel(msgChannel, resolvedNames);
            const parent = toConsoleChannelParent(msgChannel?.parent);
            broadcast({
              type: "message.receive",
              data: {
                $adapter: name,
                $endpoint: msg?.$endpoint,
                $channel: channel ?? msgChannel,
                $parent: parent,
                $sender: msg?.$sender,
                $content: msg?.$content ?? [],
                $timestamp: typeof msg?.$timestamp === "number" ? msg.$timestamp : Date.now(),
              },
            });
          };
          ad.on("message.receive", handler);
          adapterListeners.push({ adapter: ad, handler });
        }
      } catch {
        // ignore
      }
    }
  }

  return () => {
    root.off?.("request.receive", handlerReq);
    root.off?.("notice.receive", handlerNotice);
    root.off?.("endpoint.connect", handlerBotLifecycle);
    root.off?.("endpoint.disconnect", handlerBotLifecycle);
    root.off?.("endpoint.error", handlerBotLifecycle);
    for (const { adapter, handler } of adapterListeners) {
      adapter.off?.("message.receive", handler);
    }
    pendingRequestObjects.clear();
    hubInited = false;
  };
}
