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
    sender_id: String(req.$sender?.id ?? ""),
    sender_name: String(req.$sender?.name ?? ""),
    comment: String(req.$comment ?? ""),
    channel_id: String(req.$channel?.id ?? ""),
    channel_type: String(req.$channel?.type ?? "private"),
    created_at: typeof req.$timestamp === "number" ? req.$timestamp : Date.now(),
  });
  return row;
}

export function rowToRequestPushData(row: StoredRequestRow, canAct: boolean) {
  return {
    id: row.id,
    adapter: row.adapter,
    endpointId: row.endpoint_id,
    platformRequestId: row.platform_request_id,
    type: row.type,
    sender: { id: row.sender_id, name: row.sender_name },
    comment: row.comment,
    channel: { id: row.channel_id, type: row.channel_type },
    timestamp: row.created_at,
    canAct,
  };
}

export async function onRequestReceived(adapter: string, endpointId: string, req: ZhinRequest) {
  const row = await storePendingRequest(adapter, endpointId, req);
  const key = requestMemoryKey(adapter, endpointId, req.$id);
  const canAct = pendingRequestObjects.has(key);
  broadcast({ type: "endpoint:request", data: rowToRequestPushData(row, canAct) });
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
      subType: notice.$subType,
      channel: notice.$channel,
      raw,
    });
  } catch {
    payload = JSON.stringify({ type: notice.$type, error: "serialize_failed" });
  }
  const row = await insertNotice({
    adapter,
    endpoint_id: endpointId,
    notice_type: String(notice.$type ?? "unknown"),
    channel_type: String(notice.$channel?.type ?? ""),
    channel_id: String(notice.$channel?.id ?? ""),
    payload,
    created_at: typeof notice.$timestamp === "number" ? notice.$timestamp : Date.now(),
  });
  broadcast({
    type: "endpoint:notice",
    data: {
      id: row.id,
      adapter: row.adapter,
      endpointId: row.endpoint_id,
      noticeType: row.notice_type,
      channel: { id: row.channel_id, type: row.channel_type },
      payload: row.payload,
      timestamp: row.created_at,
    },
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
          type: "endpoint:request",
          data: rowToRequestPushData(row, canAct),
        })
      );
    }
  }
  const notices = await listUnconsumedNotices();
  for (const row of notices) {
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: "endpoint:notice",
          data: {
            id: row.id,
            adapter: row.adapter,
            endpointId: row.endpoint_id,
            noticeType: row.notice_type,
            channel: { id: row.channel_id, type: row.channel_type },
            payload: row.payload,
            timestamp: row.created_at,
          },
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
      type: "endpoint:lifecycle",
      data: {
        adapter: payload.adapter,
        endpointId: payload.endpointId,
        kind: payload.kind,
        error: payload.error,
        phase: payload.phase,
        detail: payload.detail,
      },
    });
  };

  root.on("request.receive", handlerReq);
  root.on("notice.receive", handlerNotice);
  root.on("endpoint.connect", handlerBotLifecycle);
  root.on("endpoint.disconnect", handlerBotLifecycle);
  root.on("endpoint.error", handlerBotLifecycle);

  // 收消息推送：向控制台广播机器人收到的消息，供「收消息展示」使用
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
              // ignore name resolution failures
            }
            const channel = toConsoleChannel(msgChannel, resolvedNames);
            const parent = toConsoleChannelParent(msgChannel?.parent);
            const payload = {
              type: "endpoint:message",
              data: {
                adapter: name,
                endpointId: msg?.$endpoint,
                channelId: msgChannel?.id,
                channelType: msgChannel?.type,
                channel,
                parent,
                sender: msg?.$sender,
                content: msg?.$content ?? [],
                timestamp: typeof msg?.$timestamp === "number" ? msg.$timestamp : Date.now(),
              },
            };
            broadcast(payload);
          };
          ad.on("message.receive", handler);
          adapterListeners.push({ adapter: ad, handler });
        }
      } catch {
        // 忽略单个适配器注册失败
      }
    }
  }

  // 返回清理函数
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
