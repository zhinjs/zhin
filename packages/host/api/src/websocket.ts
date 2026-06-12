import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { formatCompact, Adapter, Plugin, usePlugin } from '@zhin.js/core';
import type { ConfigFeature, DatabaseFeature } from "@zhin.js/core";
export interface ConsoleWebServer {
  ws: import("ws").WebSocketServer;
  entries?: Record<string, string>;
}
export type WebServer = ConsoleWebServer;
import {
  initEndpointHub,
  setEndpointHubWss,
  sendCatchUpToClient,
  getPendingRequest,
  markRequestConsumedByPlatformId,
} from "./endpoint-hub.js";
import { broadcastSse } from "./sse-hub.js";
import {
  markRequestsConsumed,
  markNoticesConsumed,
  listRequestsForBot,
  listUnconsumedRequests,
  listUnconsumedNotices,
  getRequestRowById,
} from "./endpoint-persistence.js";
import { removePendingRequest } from "./endpoint-hub.js";
import { getCronManager, generateCronJobId } from "@zhin.js/agent";
import type { CronJobRecord } from "@zhin.js/agent";
import { createNodeProjectFs } from "./rpc/project-fs.js";
import { handleCoreRpc } from "./rpc/handlers-core.js";

const plugin = usePlugin();
const { root, logger } = plugin;

function isIcqqAdapterKey(adapter: string): boolean {
  return adapter === "icqq" || adapter.endsWith("/icqq") || adapter.includes("adapter-icqq");
}

function collectEndpointsList(): Array<{
  name: string;
  adapter: string;
  connected: boolean;
  status: "online" | "offline";
  pendingRequestCount?: number;
  pendingNoticeCount?: number;
}> {
  const endpoints: Array<{
    name: string;
    adapter: string;
    connected: boolean;
    status: "online" | "offline";
  }> = [];
  const seenAdapterNames = new Set<string>();
  for (const name of root.adapters) {
    const key = String(name);
    if (seenAdapterNames.has(key)) continue;
    seenAdapterNames.add(key);
    const adapter = root.inject(name as keyof Plugin.Contexts);
    if (adapter instanceof Adapter) {
      for (const [endpointId, endpoint] of adapter.endpoints.entries()) {
        endpoints.push({
          name: endpointId,
          adapter: key,
          connected: !!(endpoint as { $connected?: boolean }).$connected,
          status: (endpoint as { $connected?: boolean }).$connected ? "online" : "offline",
        });
      }
    }
  }
  return endpoints;
}

async function collectEndpointsListWithPending(): Promise<
  Array<{
    name: string;
    adapter: string;
    connected: boolean;
    status: "online" | "offline";
    pendingRequestCount: number;
    pendingNoticeCount: number;
  }>
> {
  const endpoints = collectEndpointsList();
  let reqs: Awaited<ReturnType<typeof listUnconsumedRequests>> = [];
  let notices: Awaited<ReturnType<typeof listUnconsumedNotices>> = [];
  try {
    [reqs, notices] = await Promise.all([listUnconsumedRequests(), listUnconsumedNotices()]);
  } catch {
    // ignore
  }
  return endpoints.map((ep) => {
    const pendingRequestCount = reqs.filter(
      (r) => r.adapter === ep.adapter && r.endpoint_id === ep.name
    ).length;
    const pendingNoticeCount = notices.filter(
      (n) => n.adapter === ep.adapter && n.endpoint_id === ep.name
    ).length;
    return {
      ...ep,
      pendingRequestCount,
      pendingNoticeCount,
    };
  });
}

const ENV_WHITELIST = [".env", ".env.development", ".env.production"];

// 允许在文件管理器中访问的路径模式（相对于 cwd）
const FILE_MANAGER_ALLOWED = [
  "src",
  "plugins",
  "client",
  "package.json",
  "tsconfig.json",
  "zhin.config.yml",
  ".env",
  ".env.development",
  ".env.production",
  "README.md",
];

// 禁止访问的目录和文件
const FILE_MANAGER_BLOCKED = new Set([
  "node_modules",
  ".git",
  ".env.local",
  "data",
  "lib",
  "dist",
  "coverage",
]);

function isPathAllowed(relativePath: string): boolean {
  // 阻止路径遍历
  if (relativePath.includes("..") || path.isAbsolute(relativePath)) return false;
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const firstSegment = normalized.split("/")[0];
  if (FILE_MANAGER_BLOCKED.has(firstSegment)) return false;
  return FILE_MANAGER_ALLOWED.some((p) => normalized === p || normalized.startsWith(p + "/"));
}

function resolveConfigKey(pluginName: string): string {
  const schemaService = root.inject('schema');
  return schemaService?.resolveConfigKey(pluginName) ?? pluginName;
}

function getPluginKeys(): string[] {
  const schemaService = root.inject('schema');
  if (!schemaService) return [];
  const keys = new Set<string>();
  for (const [, configKey] of schemaService.getPluginKeyMap()) {
    keys.add(configKey);
  }
  return Array.from(keys);
}

function getConfigFilePath(): string {
  const configService = root.inject('config') as ConfigFeature | undefined;
  const primaryFile = configService?.primaryFile || 'zhin.config.yml';
  return path.resolve(process.cwd(), primaryFile);
}

/** Endpoint hub + persistence hooks without binding /server WebSocket. */
export function initConsoleHub(webServer: WebServer) {
  setEndpointHubWss(webServer.ws);
  const disposeBotHub = initEndpointHub(root as {
    on: (ev: string, fn: (...a: unknown[]) => void) => void;
    off?: (ev: string, fn: (...a: unknown[]) => void) => void;
    adapters?: Iterable<string>;
    inject?: (key: string) => unknown;
  });
  if (disposeBotHub) {
    plugin.onDispose(disposeBotHub);
  }
}

export function setupWebSocket(webServer: WebServer) {
  initConsoleHub(webServer);

  webServer.ws.on("connection", (ws: WebSocket) => {
    ws.send(JSON.stringify({
      type: "sync",
      data: { key: "entries", value: Object.values(webServer.entries ?? {}) },
    }));
    ws.send(JSON.stringify({ type: "init-data", timestamp: Date.now() }));
    void sendCatchUpToClient(ws).catch((e) =>
      logger.warn(formatCompact( { op: "bot_catchup", ok: false, error: e instanceof Error ? e.message : String(e) }))
    );

    let alive = true;
    const pingInterval = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30_000).unref?.();
    ws.on("pong", () => { alive = true; });
    ws.on("close", () => { clearInterval(pingInterval); });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(ws, message, webServer);
      } catch (error: unknown) {
        logger.error("WebSocket 消息处理错误:", error);
        ws.send(JSON.stringify({ error: "Invalid message format" }));
      }
    });
    ws.on("close", () => {});
    ws.on("error", (error) => { logger.error("WebSocket 错误:", error); });
  });
}

export async function handleWebSocketMessage(
  ws: WebSocket,
  message: any,
  webServer: WebServer,
  hostOnly = false,
) {
  const { type, requestId, pluginName } = message;

  if (!hostOnly) {
    const handled = await handleCoreRpc(message, {
      root,
      webServer,
      projectFs: createNodeProjectFs(),
      emit: (p) => ws.send(JSON.stringify(p)),
    });
    if (handled) return;
  }

  switch (type) {
    // ================================================================
    // 文件管理（Host-only）
    // ================================================================

    case "files:tree":
      try {
        const cwd = process.cwd();
        const tree = buildFileTree(cwd, "", FILE_MANAGER_ALLOWED);
        ws.send(JSON.stringify({ requestId, data: { tree } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to build file tree: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "files:read":
      try {
        const { filePath: fp } = message;
        if (!fp || !isPathAllowed(fp)) {
          ws.send(JSON.stringify({ requestId, error: `Access denied: ${fp}` }));
          break;
        }
        const absPath = path.resolve(process.cwd(), fp);
        if (!fs.existsSync(absPath)) {
          ws.send(JSON.stringify({ requestId, error: `File not found: ${fp}` }));
          break;
        }
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) {
          ws.send(JSON.stringify({ requestId, error: `Not a file: ${fp}` }));
          break;
        }
        // 限制文件大小（1MB）
        if (stat.size > 1024 * 1024) {
          ws.send(JSON.stringify({ requestId, error: `File too large: ${(stat.size / 1024).toFixed(0)}KB (max 1MB)` }));
          break;
        }
        const fileContent = fs.readFileSync(absPath, 'utf-8');
        ws.send(JSON.stringify({ requestId, data: { content: fileContent, size: stat.size } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "files:save":
      try {
        const { filePath: fp, content: fileContent } = message;
        if (!fp || !isPathAllowed(fp)) {
          ws.send(JSON.stringify({ requestId, error: `Access denied: ${fp}` }));
          break;
        }
        if (typeof fileContent !== 'string') {
          ws.send(JSON.stringify({ requestId, error: 'content field is required' }));
          break;
        }
        const absPath = path.resolve(process.cwd(), fp);
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(absPath, fileContent, 'utf-8');
        ws.send(JSON.stringify({ requestId, data: { success: true, message: `文件已保存: ${fp}` } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to save file: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    // ================================================================
    // 数据库管理
    // ================================================================

    case "db:info":
      try {
        const dbInfo = getDatabaseInfo();
        ws.send(JSON.stringify({ requestId, data: dbInfo }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get db info: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:tables":
      try {
        const tables = getDatabaseTables();
        ws.send(JSON.stringify({ requestId, data: { tables } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to list tables: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:select":
      try {
        const { table, page = 1, pageSize = 50, where } = message;
        if (!table) { ws.send(JSON.stringify({ requestId, error: 'table is required' })); break; }
        const selectResult = await dbSelect(table, page, pageSize, where);
        ws.send(JSON.stringify({ requestId, data: selectResult }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to select: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:insert":
      try {
        const { table, row } = message;
        if (!table || !row) { ws.send(JSON.stringify({ requestId, error: 'table and row are required' })); break; }
        await dbInsert(table, row);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to insert: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:update":
      try {
        const { table, row, where: updateWhere } = message;
        if (!table || !row || !updateWhere) { ws.send(JSON.stringify({ requestId, error: 'table, row, and where are required' })); break; }
        const affected = await dbUpdate(table, row, updateWhere);
        ws.send(JSON.stringify({ requestId, data: { success: true, affected } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to update: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:delete":
      try {
        const { table, where: deleteWhere } = message;
        if (!table || !deleteWhere) { ws.send(JSON.stringify({ requestId, error: 'table and where are required' })); break; }
        const deleted = await dbDelete(table, deleteWhere);
        ws.send(JSON.stringify({ requestId, data: { success: true, deleted } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to delete: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:drop-table":
      try {
        const { table: dropTableName } = message;
        if (!dropTableName) { ws.send(JSON.stringify({ requestId, error: 'table is required' })); break; }
        await dbDropTable(dropTableName);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to drop table: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    // KV 专用操作
    case "db:kv:get":
      try {
        const { table, key } = message;
        if (!table || !key) { ws.send(JSON.stringify({ requestId, error: 'table and key are required' })); break; }
        const kvValue = await kvGet(table, key);
        ws.send(JSON.stringify({ requestId, data: { key, value: kvValue } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get kv: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:kv:set":
      try {
        const { table, key, value, ttl } = message;
        if (!table || !key) { ws.send(JSON.stringify({ requestId, error: 'table and key are required' })); break; }
        await kvSet(table, key, value, ttl);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to set kv: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:kv:delete":
      try {
        const { table, key } = message;
        if (!table || !key) { ws.send(JSON.stringify({ requestId, error: 'table and key are required' })); break; }
        await kvDelete(table, key);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to delete kv: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    case "db:kv:entries":
      try {
        const { table } = message;
        if (!table) { ws.send(JSON.stringify({ requestId, error: 'table is required' })); break; }
        const kvEntries = await kvGetEntries(table);
        ws.send(JSON.stringify({ requestId, data: { entries: kvEntries } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get entries: ${error instanceof Error ? error.message : String(error)}` }));
      }
      break;

    // endpoint:list / endpoint:info / endpoint:sendMessage → rpc/handlers-core.ts

    case "endpoint:friends":
    case "endpoint:groups": {
      try {
        const d = message.data || {};
        const { adapter, endpointId } = d;
        if (!adapter || !endpointId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and endpointId required" }));
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts);
        const endpoint = ad instanceof Adapter ? ad.endpoints.get(endpointId) : undefined;
        if (!endpoint) {
          ws.send(JSON.stringify({ requestId, error: "endpoint not found" }));
          break;
        }
        const endpointAny = endpoint as unknown as Record<string, unknown>;
        if (type === "endpoint:friends") {
          let friends: Array<{ user_id: number; nickname: string; remark: string }> = [];
          if (isIcqqAdapterKey(adapter)) {
            const map = (endpointAny.friends ?? endpointAny.fl) as
              | Map<number | string, Record<string, unknown>>
              | undefined;
            friends = Array.from((map || new Map()).values()).map((f) => ({
              user_id: Number(f.user_id),
              nickname: String(f.nickname ?? ""),
              remark: String(f.remark ?? ""),
            }));
          } else if (typeof endpointAny.getFriendList === "function") {
            const raw = await (endpointAny.getFriendList as () => Promise<unknown>)();
            const arr = Array.isArray(raw)
              ? raw
              : raw && typeof raw === "object" && "data" in raw
                ? (raw as { data: unknown }).data
                : [];
            friends = (Array.isArray(arr) ? arr : []).map((f) => {
              const row = f as Record<string, unknown>;
              return {
                user_id: Number(row.user_id ?? row.userId ?? row.id ?? 0),
                nickname: String(row.nickname ?? row.name ?? row.user_id ?? ""),
                remark: String(row.remark ?? ""),
              };
            });
          } else {
            ws.send(JSON.stringify({
              requestId,
              error: `当前适配器（${adapter}）不支持好友列表`,
            }));
            break;
          }
          ws.send(JSON.stringify({ requestId, data: { friends, count: friends.length } }));
        } else {
          let groups: Array<{ group_id: number; name: string }> = [];
          if (isIcqqAdapterKey(adapter)) {
            const map = (endpointAny.groups ?? endpointAny.gl) as
              | Map<number | string, Record<string, unknown>>
              | undefined;
            groups = Array.from((map || new Map()).values()).map((g) => ({
              group_id: Number(g.group_id),
              name: String(g.name ?? g.group_id ?? ""),
            }));
          } else if (typeof endpointAny.getGroupList === "function") {
            const raw = await (endpointAny.getGroupList as () => Promise<unknown>)();
            const arr = Array.isArray(raw)
              ? raw
              : raw && typeof raw === "object" && "data" in raw
                ? (raw as { data: unknown }).data
                : [];
            groups = (Array.isArray(arr) ? arr : []).map((g) => {
              const row = g as Record<string, unknown>;
              return {
                group_id: Number(row.group_id ?? row.groupId ?? row.id ?? 0),
                name: String(row.name ?? row.group_name ?? row.group_id ?? ""),
              };
            });
          } else {
            ws.send(JSON.stringify({
              requestId,
              error: `当前适配器（${adapter}）不支持群列表`,
            }));
            break;
          }
          ws.send(JSON.stringify({ requestId, data: { groups, count: groups.length } }));
        }
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:channels": {
      try {
        const d = message.data || {};
        const { adapter, endpointId } = d;
        if (!adapter || !endpointId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and endpointId required" }));
          break;
        }
        if (isIcqqAdapterKey(adapter)) {
          ws.send(JSON.stringify({ requestId, error: "channels not supported for icqq" }));
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts);
        const endpoint = ad instanceof Adapter ? ad.endpoints.get(endpointId) : undefined;
        if (!endpoint) {
          ws.send(JSON.stringify({ requestId, error: "endpoint not found" }));
          break;
        }
        const channels: Array<{ id: string; name: string }> = [];
        const endpointMethods = endpoint as unknown as Record<string, unknown>;
        if (adapter === "qq" && typeof endpointMethods.getGuilds === "function" && typeof endpointMethods.getChannels === "function") {
          const qqEndpoint = endpoint as unknown as {
            getGuilds(): Promise<Array<Record<string, unknown>>>;
            getChannels(guildId: string): Promise<Array<Record<string, unknown>>>;
          };
          const guilds = (await qqEndpoint.getGuilds()) || [];
          for (const g of guilds) {
            const gid = String(g?.id ?? g?.guild_id ?? g);
            const chs = (await qqEndpoint.getChannels(gid)) || [];
            for (const c of chs) {
              channels.push({
                id: String(c?.id ?? c?.channel_id ?? c),
                name: String(c?.name ?? c?.channel_name ?? c?.id ?? ""),
              });
            }
          }
        } else if (ad && typeof (ad as Record<string, unknown>).listChannels === "function") {
          const adMethods = ad as Record<string, (...args: unknown[]) => unknown>;
          const result = await adMethods.listChannels(endpointId) as Record<string, unknown> | unknown[];
          if (Array.isArray(result)) channels.push(...result.map((c) => {
            const row = c as Record<string, unknown>;
            return { id: String(row?.id ?? c), name: String(row?.name ?? row?.id ?? "") };
          }));
          else if (result && typeof result === 'object' && 'channels' in result) channels.push(...((result as Record<string, unknown>).channels as Array<Record<string, unknown>>).map((c) => ({ id: String(c?.id ?? c), name: String(c?.name ?? c?.id ?? "") })));
        }
        ws.send(JSON.stringify({ requestId, data: { channels, count: channels.length } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:deleteFriend": {
      try {
        const d = message.data || {};
        const { adapter, endpointId, userId } = d;
        if (!adapter || !endpointId || !userId) {
          ws.send(JSON.stringify({ requestId, error: "adapter, endpointId, userId required" }));
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts);
        const endpoint = ad instanceof Adapter ? ad.endpoints.get(endpointId) : undefined;
        if (!endpoint) {
          ws.send(JSON.stringify({ requestId, error: "endpoint not found" }));
          break;
        }
        const endpointAny = endpoint as unknown as Record<string, unknown>;
        if (adapter === "icqq" && typeof endpointAny.deleteFriend === "function") {
          await (endpointAny.deleteFriend as (id: number) => Promise<void>)(Number(userId));
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        } else if (adapter === "icqq" && typeof endpointAny.delete_friend === "function") {
          await (endpointAny.delete_friend as (id: number) => Promise<void>)(Number(userId));
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        } else {
          ws.send(JSON.stringify({ requestId, error: "当前适配器暂不支持删除好友" }));
        }
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:requests": {
      try {
        const d = message.data || {};
        const { adapter, endpointId } = d;
        if (!adapter || !endpointId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and endpointId required" }));
          break;
        }
        const rows = await listRequestsForBot(String(adapter), String(endpointId));
        ws.send(
          JSON.stringify({
            requestId,
            data: {
              requests: rows.map((r) => ({
                id: r.id,
                platformRequestId: r.platform_request_id,
                type: r.type,
                sender: { id: r.sender_id, name: r.sender_name },
                comment: r.comment,
                channel: { id: r.channel_id, type: r.channel_type },
                timestamp: r.created_at,
              })),
            },
          })
        );
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:requestApprove":
    case "endpoint:requestReject": {
      try {
        const d = message.data || {};
        const { adapter, endpointId, requestId: platformReqId, remark, reason } = d;
        if (!adapter || !endpointId || !platformReqId) {
          ws.send(
            JSON.stringify({
              requestId,
              error: "adapter, endpointId, requestId required",
            })
          );
          break;
        }
        const req = getPendingRequest(String(adapter), String(endpointId), String(platformReqId));
        if (!req) {
          ws.send(
            JSON.stringify({
              requestId,
              error:
                "request not in memory (restart?) — use endpoint:requestConsumed to dismiss",
            })
          );
          break;
        }
        if (type === "endpoint:requestApprove") await req.$approve(remark);
        else await req.$reject(reason);
        await markRequestConsumedByPlatformId(String(adapter), String(endpointId), String(platformReqId));
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:requestConsumed": {
      try {
        const d = message.data || {};
        const ids = d.ids ?? (d.id != null ? [d.id] : []);
        if (!Array.isArray(ids) || !ids.length) {
          ws.send(JSON.stringify({ requestId, error: "id or ids required" }));
          break;
        }
        const numIds = ids.map(Number);
        for (const id of numIds) {
          const row = await getRequestRowById(id);
          if (row && row.consumed === 0) {
            removePendingRequest(row.adapter, row.endpoint_id, row.platform_request_id);
          }
        }
        await markRequestsConsumed(numIds);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:noticeConsumed": {
      try {
        const d = message.data || {};
        const ids = d.ids ?? (d.id != null ? [d.id] : []);
        if (!Array.isArray(ids) || !ids.length) {
          ws.send(JSON.stringify({ requestId, error: "id or ids required" }));
          break;
        }
        await markNoticesConsumed(ids.map(Number));
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:inboxMessages": {
      try {
        const d = message.data || {};
        const { adapter, endpointId, channelId, channelType, limit = 50, beforeId, beforeTs } = d;
        if (!adapter || !endpointId || !channelId || !channelType) {
          ws.send(JSON.stringify({ requestId, error: "adapter, endpointId, channelId, channelType required" }));
          break;
        }
        let db: DatabaseFeature;
        try {
          db = root.inject("database") as DatabaseFeature;
        } catch {
          ws.send(JSON.stringify({ requestId, data: { messages: [], inboxEnabled: false } }));
          break;
        }
        const MessageModel = db?.models?.get("unified_inbox_message") as {
          select: () => {
            where: (w: Record<string, unknown>) => {
              orderBy: (field: string, dir: 'ASC' | 'DESC') => { limit: (n: number) => Promise<unknown[]> };
            };
          };
        } | undefined;
        if (!MessageModel) {
          ws.send(JSON.stringify({ requestId, data: { messages: [], inboxEnabled: false } }));
          break;
        }
        const where: Record<string, unknown> = {
          adapter: String(adapter),
          endpoint_id: String(endpointId),
          channel_id: String(channelId),
          channel_type: String(channelType),
        };
        if (beforeTs != null) where.created_at = { $lt: Number(beforeTs) };
        if (beforeId != null) where.id = { $lt: Number(beforeId) };
        const q = MessageModel.select().where(where).orderBy("created_at", "DESC").limit(Math.min(Number(limit) || 50, 100));
        const rows = await (typeof q.then === "function" ? q : Promise.resolve(q));
        const messages = (rows || []).map((r: any) => ({
          id: r.id,
          platform_message_id: r.platform_message_id,
          sender_id: r.sender_id,
          sender_name: r.sender_name,
          content: r.content,
          raw: r.raw,
          created_at: r.created_at,
        }));
        ws.send(JSON.stringify({ requestId, data: { messages, inboxEnabled: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:inboxRequests": {
      try {
        const d = message.data || {};
        const { adapter, endpointId, limit = 30, offset = 0 } = d;
        if (!adapter || !endpointId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and endpointId required" }));
          break;
        }
        let db: DatabaseFeature;
        try {
          db = root.inject("database") as DatabaseFeature;
        } catch {
          ws.send(JSON.stringify({ requestId, data: { requests: [], inboxEnabled: false } }));
          break;
        }
        const RequestModel = db?.models?.get("unified_inbox_request") as {
          select: () => {
            where: (w: Record<string, unknown>) => {
              orderBy: (field: string, dir: 'ASC' | 'DESC') => {
                limit: (n: number) => { offset: (n: number) => Promise<unknown[]> };
              };
            };
          };
        } | undefined;
        if (!RequestModel) {
          ws.send(JSON.stringify({ requestId, data: { requests: [], inboxEnabled: false } }));
          break;
        }
        const where = { adapter: String(adapter), endpoint_id: String(endpointId) };
        const limitNum = Math.min(Number(limit) || 30, 100);
        const offsetNum = Math.max(0, Number(offset) || 0);
        const q = RequestModel.select().where(where).orderBy("created_at", "DESC").limit(limitNum).offset(offsetNum);
        const rows = await (typeof q.then === "function" ? q : Promise.resolve(q));
        const requests = (rows || []).map((r: any) => ({
          id: r.id,
          platform_request_id: r.platform_request_id,
          type: r.type,
          sub_type: r.sub_type,
          channel_id: r.channel_id,
          channel_type: r.channel_type,
          sender_id: r.sender_id,
          sender_name: r.sender_name,
          comment: r.comment,
          created_at: r.created_at,
          resolved: r.resolved,
          resolved_at: r.resolved_at,
        }));
        ws.send(JSON.stringify({ requestId, data: { requests, inboxEnabled: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:inboxNotices": {
      try {
        const d = message.data || {};
        const { adapter, endpointId, limit = 30, offset = 0 } = d;
        if (!adapter || !endpointId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and endpointId required" }));
          break;
        }
        let db: DatabaseFeature;
        try {
          db = root.inject("database") as DatabaseFeature;
        } catch {
          ws.send(JSON.stringify({ requestId, data: { notices: [], inboxEnabled: false } }));
          break;
        }
        const NoticeModel = db?.models?.get("unified_inbox_notice") as {
          select: () => {
            where: (w: Record<string, unknown>) => {
              orderBy: (field: string, dir: 'ASC' | 'DESC') => {
                limit: (n: number) => { offset: (n: number) => Promise<unknown[]> };
              };
            };
          };
        } | undefined;
        if (!NoticeModel) {
          ws.send(JSON.stringify({ requestId, data: { notices: [], inboxEnabled: false } }));
          break;
        }
        const where = { adapter: String(adapter), endpoint_id: String(endpointId) };
        const limitNum = Math.min(Number(limit) || 30, 100);
        const offsetNum = Math.max(0, Number(offset) || 0);
        const q = NoticeModel.select().where(where).orderBy("created_at", "DESC").limit(limitNum).offset(offsetNum);
        const rows = await (typeof q.then === "function" ? q : Promise.resolve(q));
        const notices = (rows || []).map((r: any) => ({
          id: r.id,
          platform_notice_id: r.platform_notice_id,
          type: r.type,
          sub_type: r.sub_type,
          channel_id: r.channel_id,
          channel_type: r.channel_type,
          operator_id: r.operator_id,
          operator_name: r.operator_name,
          target_id: r.target_id,
          target_name: r.target_name,
          payload: r.payload,
          created_at: r.created_at,
        }));
        ws.send(JSON.stringify({ requestId, data: { notices, inboxEnabled: true } }));
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    case "endpoint:groupMembers":
    case "endpoint:groupKick":
    case "endpoint:groupMute":
    case "endpoint:groupAdmin": {
      try {
        const d = message.data || {};
        const { adapter, endpointId, groupId, userId, duration, enable } = d;
        if (!adapter || !endpointId || !groupId) {
          ws.send(
            JSON.stringify({ requestId, error: "adapter, endpointId, groupId required" })
          );
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts);
        if (!ad) {
          ws.send(JSON.stringify({ requestId, error: "adapter not found" }));
          break;
        }
        const adMethods = ad as Record<string, ((...args: unknown[]) => unknown) | undefined>;
        const gid = String(groupId);
        if (type === "endpoint:groupMembers") {
          if (typeof adMethods.listMembers !== "function") {
            ws.send(JSON.stringify({ requestId, error: "adapter does not support listMembers" }));
            break;
          }
          const r = await adMethods.listMembers(endpointId, gid);
          ws.send(JSON.stringify({ requestId, data: r }));
        } else if (type === "endpoint:groupKick") {
          if (!userId) {
            ws.send(JSON.stringify({ requestId, error: "userId required" }));
            break;
          }
          if (typeof adMethods.kickMember !== "function") {
            ws.send(JSON.stringify({ requestId, error: "adapter does not support kickMember" }));
            break;
          }
          await adMethods.kickMember(endpointId, gid, String(userId));
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        } else if (type === "endpoint:groupMute") {
          if (!userId) {
            ws.send(JSON.stringify({ requestId, error: "userId required" }));
            break;
          }
          if (typeof adMethods.muteMember !== "function") {
            ws.send(JSON.stringify({ requestId, error: "adapter does not support muteMember" }));
            break;
          }
          await adMethods.muteMember(endpointId, gid, String(userId), duration ?? 600);
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        } else {
          if (!userId) {
            ws.send(JSON.stringify({ requestId, error: "userId required" }));
            break;
          }
          if (typeof adMethods.setAdmin !== "function") {
            ws.send(JSON.stringify({ requestId, error: "adapter does not support setAdmin" }));
            break;
          }
          await adMethods.setAdmin(endpointId, gid, String(userId), enable !== false);
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        }
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    // ================================================================
    // 系统管理
    // ================================================================

    case "system:restart": {
      try {
        logger.info(formatCompact( { op: "restart" }));
        ws.send(JSON.stringify({ requestId, data: { success: true, message: "正在重启..." } }));
        // 广播给所有客户端
        broadcastToAll(webServer, { type: "system:restarting" });
        // 延迟 500ms 让 WebSocket 消息发出，然后用 exit code 51 触发 CLI 守护进程重启
        setTimeout(() => {
          process.exit(51);
        }, 500);
      } catch (error: unknown) {
        ws.send(JSON.stringify({ requestId, error: error instanceof Error ? error.message : String(error) }));
      }
      break;
    }

    // cron:* → rpc/handlers-core.ts

    default:
      ws.send(JSON.stringify({ requestId, error: `Unknown message type: ${type}` }));
  }
}

// ================================================================
// 数据库操作辅助函数
// ================================================================

function getDb(): DatabaseFeature {
  return root.inject('database') as DatabaseFeature;
}

type DbType = 'related' | 'document' | 'keyvalue';

function getDbType(): DbType {
  const dbFeature = getDb();
  const dialectName = dbFeature.db.dialect.name;
  if (['mongodb'].includes(dialectName)) return 'document';
  if (['redis'].includes(dialectName)) return 'keyvalue';
  return 'related';
}

function getDatabaseInfo() {
  const dbFeature = getDb();
  const db = dbFeature.db;
  return {
    dialect: db.dialectName,
    type: getDbType(),
    tables: Array.from(db.models.keys()),
  };
}

function getDatabaseTables() {
  const dbFeature = getDb();
  const db = dbFeature.db;
  const dbType = getDbType();
  const tables: Array<{ name: string; columns?: Record<string, any> }> = [];
  for (const [name] of db.models) {
    const def = db.definitions.get(name);
    tables.push({ name: name as string, columns: def ? Object.fromEntries(Object.entries(def).map(([col, colDef]) => [col, colDef])) : undefined });
  }
  return tables;
}

async function dbSelect(table: string, page: number, pageSize: number, where?: any) {
  const dbFeature = getDb();
  const db = dbFeature.db;
  const dbType = getDbType();
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === 'keyvalue') {
    // KV: return entries
    const kvModel = model as any;
    const allEntries: Array<[string, any]> = await kvModel.entries();
    const total = allEntries.length;
    const start = (page - 1) * pageSize;
    const rows = allEntries.slice(start, start + pageSize).map(([k, v]: [string, any]) => ({ key: k, value: v }));
    return { rows, total, page, pageSize };
  }

  // Related / Document: use select with pagination
  let selection = model.select();
  if (where && Object.keys(where).length > 0) {
    selection = selection.where(where);
  }
  // Get total count first
  let total: number;
  try {
    const countResult = await (db as any).aggregate(table).count('*', 'total').where(where || {});
    total = countResult?.[0]?.total ?? 0;
  } catch {
    // fallback: just fetch all and count
    const all = await model.select();
    total = (all as any[]).length;
  }
  const offset = (page - 1) * pageSize;
  let query = model.select();
  if (where && Object.keys(where).length > 0) {
    query = query.where(where);
  }
  const rows = await query.limit(pageSize).offset(offset) as any[];
  return { rows, total, page, pageSize };
}

async function dbInsert(table: string, row: any) {
  const dbFeature = getDb();
  const db = dbFeature.db;
  const dbType = getDbType();
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === 'keyvalue') {
    const kvModel = model as any;
    if (!row.key) throw new Error('key is required for KV insert');
    await kvModel.set(row.key, row.value);
    return;
  }

  if (dbType === 'document') {
    await (model as any).create(row);
    return;
  }

  await model.insert(row);
}

async function dbUpdate(table: string, row: any, where: any) {
  const dbFeature = getDb();
  const db = dbFeature.db;
  const dbType = getDbType();
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === 'keyvalue') {
    const kvModel = model as any;
    if (!where.key) throw new Error('key is required for KV update');
    await kvModel.set(where.key, row.value);
    return 1;
  }

  if (dbType === 'document') {
    if (where._id) {
      return await (model as any).updateById(where._id, row);
    }
  }

  return await model.update(row).where(where);
}

async function dbDelete(table: string, where: any) {
  const dbFeature = getDb();
  const db = dbFeature.db;
  const dbType = getDbType();
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);

  if (dbType === 'keyvalue') {
    const kvModel = model as any;
    if (!where.key) throw new Error('key is required for KV delete');
    await kvModel.deleteByKey(where.key);
    return 1;
  }

  if (dbType === 'document') {
    if (where._id) {
      return await (model as any).deleteById(where._id);
    }
  }

  return await model.delete(where);
}

async function dbDropTable(table: string) {
  const dbFeature = getDb();
  const db = dbFeature.db;
  const model = db.models.get(table);
  if (!model) throw new Error(`Table '${table}' not found`);
  const sql = db.dialect.formatDropTable(table, true);
  await db.query(sql);
  db.models.delete(table);
  db.definitions.delete(table);
}

// KV 专用操作
async function kvGet(table: string, key: string) {
  const dbFeature = getDb();
  const model = dbFeature.db.models.get(table) as any;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  return await model.get(key);
}

async function kvSet(table: string, key: string, value: any, ttl?: number) {
  const dbFeature = getDb();
  const model = dbFeature.db.models.get(table) as any;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  await model.set(key, value, ttl);
}

async function kvDelete(table: string, key: string) {
  const dbFeature = getDb();
  const model = dbFeature.db.models.get(table) as any;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  await model.deleteByKey(key);
}

async function kvGetEntries(table: string) {
  const dbFeature = getDb();
  const model = dbFeature.db.models.get(table) as any;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  const entries: Array<[string, any]> = await model.entries();
  return entries.map(([k, v]) => ({ key: k, value: v }));
}

interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

function buildFileTree(cwd: string, relativePath: string, allowed: string[]): FileTreeNode[] {
  const tree: FileTreeNode[] = [];
  const absDir = path.resolve(cwd, relativePath);

  for (const entry of allowed) {
    // 只处理顶层匹配项
    if (relativePath && !entry.startsWith(relativePath + "/")) continue;
    const entryRelative = relativePath ? entry.slice(relativePath.length + 1) : entry;
    if (entryRelative.includes("/")) continue; // 跳过嵌套，由递归处理

    const absPath = path.resolve(cwd, entry);
    if (!fs.existsSync(absPath)) continue;

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      tree.push({
        name: entryRelative,
        path: entry,
        type: "directory",
        children: buildDirectoryTree(cwd, entry, 3),
      });
    } else if (stat.isFile()) {
      tree.push({ name: entryRelative, path: entry, type: "file" });
    }
  }

  return tree.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function buildDirectoryTree(cwd: string, relativePath: string, maxDepth: number): FileTreeNode[] {
  if (maxDepth <= 0) return [];
  const absDir = path.resolve(cwd, relativePath);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [];

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const result: FileTreeNode[] = [];

  for (const entry of entries) {
    if (FILE_MANAGER_BLOCKED.has(entry.name) || entry.name.startsWith(".")) continue;
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: childRelative,
        type: "directory",
        children: buildDirectoryTree(cwd, childRelative, maxDepth - 1),
      });
    } else if (entry.isFile()) {
      result.push({ name: entry.name, path: childRelative, type: "file" });
    }
  }

  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function findPluginByConfigKey(rootPlugin: Plugin, configKey: string): Plugin | null {
  for (const child of (rootPlugin.children as Plugin[])) {
    if (child.name === configKey || child.name.endsWith(`-${configKey}`) || child.name.includes(configKey)) {
      return child;
    }
    const found = findPluginByConfigKey(child as Plugin, configKey);
    if (found) return found;
  }
  return null;
}

export function broadcastToAll(webServer: WebServer, message: any) {
  broadcastSse(message);
  for (const ws of webServer.ws.clients || []) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

export function notifyDataUpdate(webServer: WebServer) {
  broadcastToAll(webServer, { type: "data-update", timestamp: Date.now() });
}
