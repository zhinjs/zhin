/**
 * 机器人请求/通知：内存 Request 映射 + WS 广播 + 事件注册
 */
import type WebSocket from "ws";
import type { Request as ZhinRequest } from "@zhin.js/core";
import {
  insertRequest,
  insertNotice,
  listUnconsumedRequests,
  listUnconsumedNotices,
  markRequestsConsumed,
  findRequestRow,
  type StoredRequestRow,
} from "./bot-persistence.js";

type WsIterable = { clients?: Set<WebSocket> | WebSocket[] };

let wssRef: WsIterable | null = null;
let hubInited = false;

export function setBotHubWss(wss: WsIterable) {
  wssRef = wss;
}

function broadcast(obj: object) {
  const msg = JSON.stringify(obj);
  const clients = wssRef?.clients;
  if (!clients) return;
  const list = clients instanceof Set ? [...clients] : clients;
  for (const ws of list) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function requestMemoryKey(adapter: string, botId: string, platformId: string) {
  return `${adapter}:${botId}:${platformId}`;
}

const pendingRequestObjects = new Map<string, ZhinRequest>();

export async function storePendingRequest(
  adapter: string,
  botId: string,
  req: ZhinRequest
): Promise<StoredRequestRow> {
  const platformId = req.$id;
  const key = requestMemoryKey(adapter, botId, platformId);
  pendingRequestObjects.set(key, req);
  const row = await insertRequest({
    adapter,
    bot_id: botId,
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
    botId: row.bot_id,
    platformRequestId: row.platform_request_id,
    type: row.type,
    sender: { id: row.sender_id, name: row.sender_name },
    comment: row.comment,
    channel: { id: row.channel_id, type: row.channel_type },
    timestamp: row.created_at,
    canAct,
  };
}

export async function onRequestReceived(adapter: string, botId: string, req: ZhinRequest) {
  const row = await storePendingRequest(adapter, botId, req);
  const key = requestMemoryKey(adapter, botId, req.$id);
  const canAct = pendingRequestObjects.has(key);
  broadcast({ type: "bot:request", data: rowToRequestPushData(row, canAct) });
}

export async function onNoticeReceived(adapter: string, botId: string, notice: any) {
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
    bot_id: botId,
    notice_type: String(notice.$type ?? "unknown"),
    channel_type: String(notice.$channel?.type ?? ""),
    channel_id: String(notice.$channel?.id ?? ""),
    payload,
    created_at: typeof notice.$timestamp === "number" ? notice.$timestamp : Date.now(),
  });
  broadcast({
    type: "bot:notice",
    data: {
      id: row.id,
      adapter: row.adapter,
      botId: row.bot_id,
      noticeType: row.notice_type,
      channel: { id: row.channel_id, type: row.channel_type },
      payload: row.payload,
      timestamp: row.created_at,
    },
  });
}

export function getPendingRequest(
  adapter: string,
  botId: string,
  platformRequestId: string
): ZhinRequest | undefined {
  return pendingRequestObjects.get(requestMemoryKey(adapter, botId, platformRequestId));
}

export function removePendingRequest(adapter: string, botId: string, platformRequestId: string) {
  pendingRequestObjects.delete(requestMemoryKey(adapter, botId, platformRequestId));
}

export async function markRequestConsumedByPlatformId(
  adapter: string,
  botId: string,
  platformRequestId: string
) {
  const row = await findRequestRow(adapter, botId, platformRequestId);
  if (row) await markRequestsConsumed([row.id]);
  removePendingRequest(adapter, botId, platformRequestId);
}

export async function sendCatchUpToClient(ws: WebSocket) {
  const reqs = await listUnconsumedRequests();
  for (const row of reqs) {
    const canAct = pendingRequestObjects.has(
      requestMemoryKey(row.adapter, row.bot_id, row.platform_request_id)
    );
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: "bot:request",
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
          type: "bot:notice",
          data: {
            id: row.id,
            adapter: row.adapter,
            botId: row.bot_id,
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

export function initBotHub(root: {
  on: (ev: string, fn: (...a: any[]) => void) => void;
  off?: (ev: string, fn: (...a: any[]) => void) => void;
  adapters?: Iterable<string>;
  inject?: (key: string) => unknown;
}): (() => void) | undefined {
  if (hubInited) return;
  hubInited = true;

  const handlerReq = (req: ZhinRequest) => {
    const adapter = String(req.$adapter);
    const botId = String(req.$bot);
    onRequestReceived(adapter, botId, req);
  };
  const handlerNotice = (notice: any) => {
    const adapter = String(notice.$adapter);
    const botId = String(notice.$bot);
    onNoticeReceived(adapter, botId, notice);
  };

  root.on("request.receive", handlerReq);
  root.on("notice.receive", handlerNotice);

  // 收消息推送：向控制台广播机器人收到的消息，供「收消息展示」使用
  const adapterNames = root.adapters ? [...(root.adapters as Iterable<string>)] : [];
  const inject = root.inject;
  const adapterListeners: Array<{ adapter: any; handler: (...a: any[]) => void }> = [];
  if (inject && typeof inject === "function" && adapterNames.length > 0) {
    for (const name of adapterNames) {
      try {
        const ad = inject(name) as { on?: (ev: string, fn: (...a: any[]) => void) => void; off?: (ev: string, fn: (...a: any[]) => void) => void } | null;
        if (ad && typeof ad.on === "function") {
          const handler = (msg: any) => {
            const payload = {
              type: "bot:message",
              data: {
                adapter: name,
                botId: msg?.$bot,
                channelId: msg?.$channel?.id,
                channelType: msg?.$channel?.type,
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
    for (const { adapter, handler } of adapterListeners) {
      adapter.off?.("message.receive", handler);
    }
    hubInited = false;
  };
}
