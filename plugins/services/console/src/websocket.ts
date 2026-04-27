import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { Plugin, usePlugin, Adapter } from "@zhin.js/core";
import type { SchemaFeature, ConfigFeature, DatabaseFeature } from "@zhin.js/core";
export interface WebServerCompat {
  ws: import("ws").WebSocketServer;
  entries?: Record<string, string>;
}
type WebServer = WebServerCompat;
import {
  initBotHub,
  setBotHubWss,
  sendCatchUpToClient,
  getPendingRequest,
  markRequestConsumedByPlatformId,
} from "./bot-hub.js";
import {
  markRequestsConsumed,
  markNoticesConsumed,
  listRequestsForBot,
  listUnconsumedRequests,
  listUnconsumedNotices,
  getRequestRowById,
} from "./bot-persistence.js";
import { removePendingRequest } from "./bot-hub.js";
import { getCronManager, generateCronJobId } from "@zhin.js/agent";
import type { CronJobRecord } from "@zhin.js/agent";

const plugin = usePlugin();
const { root, logger } = plugin;

function collectBotsList(): Array<{
  name: string;
  adapter: string;
  connected: boolean;
  status: "online" | "offline";
  pendingRequestCount?: number;
  pendingNoticeCount?: number;
}> {
  const bots: Array<{
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
      for (const [botName, bot] of adapter.bots.entries()) {
        bots.push({
          name: botName,
          adapter: key,
          connected: !!(bot as { $connected?: boolean }).$connected,
          status: (bot as { $connected?: boolean }).$connected ? "online" : "offline",
        });
      }
    }
  }
  return bots;
}

async function collectBotsListWithPending(): Promise<
  Array<{
    name: string;
    adapter: string;
    connected: boolean;
    status: "online" | "offline";
    pendingRequestCount: number;
    pendingNoticeCount: number;
  }>
> {
  const bots = collectBotsList();
  let reqs: Awaited<ReturnType<typeof listUnconsumedRequests>> = [];
  let notices: Awaited<ReturnType<typeof listUnconsumedNotices>> = [];
  try {
    [reqs, notices] = await Promise.all([listUnconsumedRequests(), listUnconsumedNotices()]);
  } catch {
    // ignore
  }
  return bots.map((bot) => {
    const pendingRequestCount = reqs.filter(
      (r) => r.adapter === bot.adapter && r.bot_id === bot.name
    ).length;
    const pendingNoticeCount = notices.filter(
      (n) => n.adapter === bot.adapter && n.bot_id === bot.name
    ).length;
    return {
      ...bot,
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
  const schemaService = root.inject('schema' as any) as SchemaFeature | null;
  return schemaService?.resolveConfigKey(pluginName) ?? pluginName;
}

function getPluginKeys(): string[] {
  const schemaService = root.inject('schema' as any) as SchemaFeature | null;
  if (!schemaService) return [];
  const keys = new Set<string>();
  for (const [, configKey] of schemaService.getPluginKeyMap()) {
    keys.add(configKey);
  }
  return Array.from(keys);
}

function getConfigFilePath(): string {
  return path.resolve(process.cwd(), 'zhin.config.yml');
}

export function setupWebSocket(webServer: WebServer) {
  setBotHubWss(webServer.ws);
  const disposeBotHub = initBotHub(root as {
    on: (ev: string, fn: (...a: unknown[]) => void) => void;
    off?: (ev: string, fn: (...a: unknown[]) => void) => void;
    adapters?: Iterable<string>;
    inject?: (key: string) => unknown;
  });
  if (disposeBotHub) {
    plugin.onDispose(disposeBotHub);
  }

  webServer.ws.on("connection", (ws: WebSocket) => {
    ws.send(JSON.stringify({
      type: "sync",
      data: { key: "entries", value: Object.values(webServer.entries ?? {}) },
    }));
    ws.send(JSON.stringify({ type: "init-data", timestamp: Date.now() }));
    void sendCatchUpToClient(ws).catch((e) =>
      logger.warn("[console] bot catch-up failed", (e as Error).message)
    );

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(ws, message, webServer);
      } catch (error) {
        logger.error("WebSocket 消息处理错误:", error);
        ws.send(JSON.stringify({ error: "Invalid message format" }));
      }
    });
    ws.on("close", () => {});
    ws.on("error", (error) => { logger.error("WebSocket 错误:", error); });
  });
}

async function handleWebSocketMessage(
  ws: WebSocket,
  message: any,
  webServer: WebServer
) {
  const { type, requestId, pluginName } = message;

  switch (type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong", requestId }));
      break;

    case "entries:get":
      ws.send(JSON.stringify({ requestId, data: Object.values(webServer.entries ?? {}) }));
      break;

    // ================================================================
    // 配置文件原始 YAML 读写（用于配置管理页面）
    // ================================================================

    case "config:get-yaml":
      try {
        const filePath = getConfigFilePath();
        const yaml = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        ws.send(JSON.stringify({ requestId, data: { yaml, pluginKeys: getPluginKeys() } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to read config: ${(error as Error).message}` }));
      }
      break;

    case "config:save-yaml":
      try {
        const { yaml } = message;
        if (typeof yaml !== 'string') {
          ws.send(JSON.stringify({ requestId, error: 'yaml field is required' }));
          break;
        }
        const filePath = getConfigFilePath();
        fs.writeFileSync(filePath, yaml, 'utf-8');
        const configService = root.inject('config') as ConfigFeature;
        const loader = configService.configs.get('zhin.config.yml');
        if (loader) loader.load();
        ws.send(JSON.stringify({ requestId, data: { success: true, message: '配置已保存，需重启生效' } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to save config: ${(error as Error).message}` }));
      }
      break;

    // ================================================================
    // 插件配置（供 PluginConfigForm 使用）
    // ================================================================

    case "config:get":
      try {
        const configService = root.inject('config') as ConfigFeature;
        const rawConfig = configService.getRaw<Record<string, any>>('zhin.config.yml');
        if (!pluginName) {
          ws.send(JSON.stringify({ requestId, data: rawConfig }));
        } else {
          const configKey = resolveConfigKey(pluginName);
          ws.send(JSON.stringify({ requestId, data: rawConfig[configKey] || {} }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get config: ${(error as Error).message}` }));
      }
      break;

    case "config:get-all":
      try {
        const configService = root.inject('config') as ConfigFeature;
        const rawConfig = configService.getRaw<Record<string, any>>('zhin.config.yml');
        const allConfigs: Record<string, any> = { ...rawConfig };
        const schemaService = root.inject('schema' as any) as SchemaFeature | null;
        if (schemaService) {
          for (const [pName, configKey] of schemaService.getPluginKeyMap()) {
            if (pName !== configKey) {
              allConfigs[pName] = rawConfig[configKey] || {};
            }
          }
        }
        ws.send(JSON.stringify({ requestId, data: allConfigs }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get all configs: ${(error as Error).message}` }));
      }
      break;

    case "config:set":
      try {
        const { data } = message;
        if (!pluginName) {
          ws.send(JSON.stringify({ requestId, error: 'Plugin name is required' }));
          break;
        }
        const configKey = resolveConfigKey(pluginName);
        const configService = root.inject('config') as ConfigFeature;
        const loader = configService.configs.get('zhin.config.yml');
        if (!loader) {
          ws.send(JSON.stringify({ requestId, error: 'Config file not loaded' }));
          break;
        }
        loader.patchKey(configKey, data);

        broadcastToAll(webServer, { type: 'config:updated', data: { pluginName, config: data } });

        const schemaService = root.inject('schema' as any) as SchemaFeature | null;
        const reloadable = schemaService?.isReloadable?.(pluginName) ?? false;

        if (reloadable) {
          const target = findPluginByConfigKey(root, pluginName);
          if (target) {
            try {
              await target.reload();
              ws.send(JSON.stringify({ requestId, data: { success: true, reloaded: true } }));
            } catch (reloadErr) {
              logger.warn(`重载插件 ${pluginName} 失败: ${(reloadErr as Error).message}`);
              ws.send(JSON.stringify({ requestId, data: { success: true, reloaded: false, message: '配置已保存，但重载失败' } }));
            }
          } else {
            ws.send(JSON.stringify({ requestId, data: { success: true, reloaded: false, message: '配置已保存' } }));
          }
        } else {
          ws.send(JSON.stringify({ requestId, data: { success: true, reloaded: false, message: '配置已保存，需重启进程才能生效' } }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to set config: ${(error as Error).message}` }));
      }
      break;

    // ================================================================
    // Schema（供 PluginConfigForm 使用）
    // ================================================================

    case "schema:get":
      try {
        const schemaService = root.inject('schema' as any) as SchemaFeature | null;
        const schema = pluginName && schemaService ? schemaService.get(pluginName) : null;
        ws.send(JSON.stringify({ requestId, data: schema ? schema.toJSON() : null }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get schema: ${(error as Error).message}` }));
      }
      break;

    case "schema:get-all":
      try {
        const schemaService = root.inject('schema' as any) as SchemaFeature | null;
        const schemas: Record<string, any> = {};
        if (schemaService) {
          for (const record of schemaService.items) {
            if (record.key && record.schema) {
              schemas[record.key] = record.schema.toJSON();
            }
          }
          for (const [pName, configKey] of schemaService.getPluginKeyMap()) {
            if (pName !== configKey && schemas[configKey]) {
              schemas[pName] = schemas[configKey];
            }
          }
        }
        ws.send(JSON.stringify({ requestId, data: schemas }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get all schemas: ${(error as Error).message}` }));
      }
      break;

    // ================================================================
    // 环境变量文件管理
    // ================================================================

    case "env:list":
      try {
        const cwd = process.cwd();
        const files = ENV_WHITELIST.map(name => ({
          name,
          exists: fs.existsSync(path.resolve(cwd, name)),
        }));
        ws.send(JSON.stringify({ requestId, data: { files } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to list env files: ${(error as Error).message}` }));
      }
      break;

    case "env:get":
      try {
        const { filename } = message;
        if (!filename || !ENV_WHITELIST.includes(filename)) {
          ws.send(JSON.stringify({ requestId, error: `Invalid env file: ${filename}` }));
          break;
        }
        const envPath = path.resolve(process.cwd(), filename);
        const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
        ws.send(JSON.stringify({ requestId, data: { content } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to read env file: ${(error as Error).message}` }));
      }
      break;

    case "env:save":
      try {
        const { filename, content } = message;
        if (!filename || !ENV_WHITELIST.includes(filename)) {
          ws.send(JSON.stringify({ requestId, error: `Invalid env file: ${filename}` }));
          break;
        }
        if (typeof content !== 'string') {
          ws.send(JSON.stringify({ requestId, error: 'content field is required' }));
          break;
        }
        const envPath = path.resolve(process.cwd(), filename);
        fs.writeFileSync(envPath, content, 'utf-8');
        ws.send(JSON.stringify({ requestId, data: { success: true, message: '环境变量已保存，需重启生效' } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to save env file: ${(error as Error).message}` }));
      }
      break;

    // ================================================================
    // 文件管理
    // ================================================================

    case "files:tree":
      try {
        const cwd = process.cwd();
        const tree = buildFileTree(cwd, "", FILE_MANAGER_ALLOWED);
        ws.send(JSON.stringify({ requestId, data: { tree } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to build file tree: ${(error as Error).message}` }));
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
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to read file: ${(error as Error).message}` }));
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
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to save file: ${(error as Error).message}` }));
      }
      break;

    // ================================================================
    // 数据库管理
    // ================================================================

    case "db:info":
      try {
        const dbInfo = getDatabaseInfo();
        ws.send(JSON.stringify({ requestId, data: dbInfo }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get db info: ${(error as Error).message}` }));
      }
      break;

    case "db:tables":
      try {
        const tables = getDatabaseTables();
        ws.send(JSON.stringify({ requestId, data: { tables } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to list tables: ${(error as Error).message}` }));
      }
      break;

    case "db:select":
      try {
        const { table, page = 1, pageSize = 50, where } = message;
        if (!table) { ws.send(JSON.stringify({ requestId, error: 'table is required' })); break; }
        const selectResult = await dbSelect(table, page, pageSize, where);
        ws.send(JSON.stringify({ requestId, data: selectResult }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to select: ${(error as Error).message}` }));
      }
      break;

    case "db:insert":
      try {
        const { table, row } = message;
        if (!table || !row) { ws.send(JSON.stringify({ requestId, error: 'table and row are required' })); break; }
        await dbInsert(table, row);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to insert: ${(error as Error).message}` }));
      }
      break;

    case "db:update":
      try {
        const { table, row, where: updateWhere } = message;
        if (!table || !row || !updateWhere) { ws.send(JSON.stringify({ requestId, error: 'table, row, and where are required' })); break; }
        const affected = await dbUpdate(table, row, updateWhere);
        ws.send(JSON.stringify({ requestId, data: { success: true, affected } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to update: ${(error as Error).message}` }));
      }
      break;

    case "db:delete":
      try {
        const { table, where: deleteWhere } = message;
        if (!table || !deleteWhere) { ws.send(JSON.stringify({ requestId, error: 'table and where are required' })); break; }
        const deleted = await dbDelete(table, deleteWhere);
        ws.send(JSON.stringify({ requestId, data: { success: true, deleted } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to delete: ${(error as Error).message}` }));
      }
      break;

    case "db:drop-table":
      try {
        const { table: dropTableName } = message;
        if (!dropTableName) { ws.send(JSON.stringify({ requestId, error: 'table is required' })); break; }
        await dbDropTable(dropTableName);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to drop table: ${(error as Error).message}` }));
      }
      break;

    // KV 专用操作
    case "db:kv:get":
      try {
        const { table, key } = message;
        if (!table || !key) { ws.send(JSON.stringify({ requestId, error: 'table and key are required' })); break; }
        const kvValue = await kvGet(table, key);
        ws.send(JSON.stringify({ requestId, data: { key, value: kvValue } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get kv: ${(error as Error).message}` }));
      }
      break;

    case "db:kv:set":
      try {
        const { table, key, value, ttl } = message;
        if (!table || !key) { ws.send(JSON.stringify({ requestId, error: 'table and key are required' })); break; }
        await kvSet(table, key, value, ttl);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to set kv: ${(error as Error).message}` }));
      }
      break;

    case "db:kv:delete":
      try {
        const { table, key } = message;
        if (!table || !key) { ws.send(JSON.stringify({ requestId, error: 'table and key are required' })); break; }
        await kvDelete(table, key);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to delete kv: ${(error as Error).message}` }));
      }
      break;

    case "db:kv:entries":
      try {
        const { table } = message;
        if (!table) { ws.send(JSON.stringify({ requestId, error: 'table is required' })); break; }
        const kvEntries = await kvGetEntries(table);
        ws.send(JSON.stringify({ requestId, data: { entries: kvEntries } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get entries: ${(error as Error).message}` }));
      }
      break;

    // ================================================================
    // 机器人管理（WebSocket）
    // ================================================================

    case "bot:list": {
      try {
        const botsWithPending = await collectBotsListWithPending();
        ws.send(JSON.stringify({ requestId, data: { bots: botsWithPending } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:info": {
      try {
        const d = message.data || {};
        const { adapter, botId } = d;
        if (!adapter || !botId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and botId required" }));
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts);
        if (!(ad instanceof Adapter)) {
          ws.send(JSON.stringify({ requestId, error: "adapter not found" }));
          break;
        }
        const bot = ad.bots.get(botId);
        if (!bot) {
          ws.send(JSON.stringify({ requestId, error: "bot not found" }));
          break;
        }
        ws.send(
          JSON.stringify({
            requestId,
            data: {
              name: botId,
              adapter: String(adapter),
              connected: !!bot.$connected,
              status: bot.$connected ? "online" : "offline",
            },
          })
        );
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:sendMessage": {
      try {
        const d = message.data || {};
        const { adapter, botId, id, type: msgType, content } = d;
        if (!adapter || !botId || !id || !msgType || content === undefined) {
          ws.send(
            JSON.stringify({
              requestId,
              error: "adapter, botId, id, type, content required",
            })
          );
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts);
        if (!(ad instanceof Adapter)) {
          ws.send(JSON.stringify({ requestId, error: "adapter not found" }));
          break;
        }
        const normalized =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
              : String(content);
        const messageId = await ad.sendMessage({
          context: adapter,
          bot: botId,
          id: String(id),
          type: msgType as "private" | "group" | "channel",
          content: normalized,
        });
        ws.send(JSON.stringify({ requestId, data: { messageId } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:friends":
    case "bot:groups": {
      try {
        const d = message.data || {};
        const { adapter, botId } = d;
        if (!adapter || !botId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and botId required" }));
          break;
        }
        if (adapter !== "icqq") {
          ws.send(JSON.stringify({ requestId, error: "not supported for this adapter" }));
          break;
        }
        const ad = root.inject("icqq" as keyof Plugin.Contexts) as any;
        const bot = ad?.bots?.get?.(botId);
        if (!bot) {
          ws.send(JSON.stringify({ requestId, error: "bot not found" }));
          break;
        }
        if (type === "bot:friends") {
          const fl = bot.fl;
          const friends = Array.from((fl || new Map()).values()).map((f: any) => ({
            user_id: f.user_id,
            nickname: f.nickname,
            remark: f.remark,
          }));
          ws.send(JSON.stringify({ requestId, data: { friends, count: friends.length } }));
        } else {
          const gl = bot.gl;
          const groups = Array.from((gl || new Map()).values()).map((g: any) => ({
            group_id: g.group_id,
            name: g.name,
          }));
          ws.send(JSON.stringify({ requestId, data: { groups, count: groups.length } }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:channels": {
      try {
        const d = message.data || {};
        const { adapter, botId } = d;
        if (!adapter || !botId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and botId required" }));
          break;
        }
        if (adapter === "icqq") {
          ws.send(JSON.stringify({ requestId, error: "channels not supported for icqq" }));
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts) as any;
        const bot = ad?.bots?.get?.(botId);
        if (!bot) {
          ws.send(JSON.stringify({ requestId, error: "bot not found" }));
          break;
        }
        const channels: Array<{ id: string; name: string }> = [];
        if (adapter === "qq" && typeof bot.getGuilds === "function" && typeof bot.getChannels === "function") {
          const guilds = (await bot.getGuilds()) || [];
          for (const g of guilds) {
            const gid = g?.id ?? g?.guild_id ?? String(g);
            const chs = (await bot.getChannels(gid)) || [];
            for (const c of chs) {
              channels.push({
                id: String(c?.id ?? c?.channel_id ?? c),
                name: String(c?.name ?? c?.channel_name ?? c?.id ?? ""),
              });
            }
          }
        } else if (typeof (ad as any)?.listChannels === "function") {
          const result = await (ad as any).listChannels(botId);
          if (Array.isArray(result)) channels.push(...result.map((c: any) => ({ id: String(c?.id ?? c), name: String(c?.name ?? c?.id ?? "") })));
          else if (result?.channels) channels.push(...result.channels.map((c: any) => ({ id: String(c?.id ?? c), name: String(c?.name ?? c?.id ?? "") })));
        }
        ws.send(JSON.stringify({ requestId, data: { channels, count: channels.length } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:deleteFriend": {
      try {
        const d = message.data || {};
        const { adapter, botId, userId } = d;
        if (!adapter || !botId || !userId) {
          ws.send(JSON.stringify({ requestId, error: "adapter, botId, userId required" }));
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts) as any;
        const bot = ad?.bots?.get?.(botId);
        if (!bot) {
          ws.send(JSON.stringify({ requestId, error: "bot not found" }));
          break;
        }
        if (adapter === "icqq" && typeof bot.deleteFriend === "function") {
          await bot.deleteFriend(Number(userId));
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        } else if (adapter === "icqq" && typeof bot.delete_friend === "function") {
          await bot.delete_friend(Number(userId));
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        } else {
          ws.send(JSON.stringify({ requestId, error: "当前适配器暂不支持删除好友" }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:requests": {
      try {
        const d = message.data || {};
        const { adapter, botId } = d;
        if (!adapter || !botId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and botId required" }));
          break;
        }
        const rows = await listRequestsForBot(String(adapter), String(botId));
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
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:requestApprove":
    case "bot:requestReject": {
      try {
        const d = message.data || {};
        const { adapter, botId, requestId: platformReqId, remark, reason } = d;
        if (!adapter || !botId || !platformReqId) {
          ws.send(
            JSON.stringify({
              requestId,
              error: "adapter, botId, requestId required",
            })
          );
          break;
        }
        const req = getPendingRequest(String(adapter), String(botId), String(platformReqId));
        if (!req) {
          ws.send(
            JSON.stringify({
              requestId,
              error:
                "request not in memory (restart?) — use bot:requestConsumed to dismiss",
            })
          );
          break;
        }
        if (type === "bot:requestApprove") await req.$approve(remark);
        else await req.$reject(reason);
        await markRequestConsumedByPlatformId(String(adapter), String(botId), String(platformReqId));
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:requestConsumed": {
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
            removePendingRequest(row.adapter, row.bot_id, row.platform_request_id);
          }
        }
        await markRequestsConsumed(numIds);
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:noticeConsumed": {
      try {
        const d = message.data || {};
        const ids = d.ids ?? (d.id != null ? [d.id] : []);
        if (!Array.isArray(ids) || !ids.length) {
          ws.send(JSON.stringify({ requestId, error: "id or ids required" }));
          break;
        }
        await markNoticesConsumed(ids.map(Number));
        ws.send(JSON.stringify({ requestId, data: { success: true } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:inboxMessages": {
      try {
        const d = message.data || {};
        const { adapter, botId, channelId, channelType, limit = 50, beforeId, beforeTs } = d;
        if (!adapter || !botId || !channelId || !channelType) {
          ws.send(JSON.stringify({ requestId, error: "adapter, botId, channelId, channelType required" }));
          break;
        }
        let db: DatabaseFeature;
        try {
          db = root.inject("database") as DatabaseFeature;
        } catch {
          ws.send(JSON.stringify({ requestId, data: { messages: [], inboxEnabled: false } }));
          break;
        }
        const MessageModel = db?.models?.get("unified_inbox_message") as any;
        if (!MessageModel) {
          ws.send(JSON.stringify({ requestId, data: { messages: [], inboxEnabled: false } }));
          break;
        }
        const where: Record<string, unknown> = {
          adapter: String(adapter),
          bot_id: String(botId),
          channel_id: String(channelId),
          channel_type: String(channelType),
        };
        if (beforeTs != null) where.created_at = { $lt: Number(beforeTs) };
        if (beforeId != null) where.id = { $lt: Number(beforeId) };
        let q = MessageModel.select().where(where).orderBy("created_at", "DESC").limit(Math.min(Number(limit) || 50, 100));
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
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:inboxRequests": {
      try {
        const d = message.data || {};
        const { adapter, botId, limit = 30, offset = 0 } = d;
        if (!adapter || !botId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and botId required" }));
          break;
        }
        let db: DatabaseFeature;
        try {
          db = root.inject("database") as DatabaseFeature;
        } catch {
          ws.send(JSON.stringify({ requestId, data: { requests: [], inboxEnabled: false } }));
          break;
        }
        const RequestModel = db?.models?.get("unified_inbox_request") as any;
        if (!RequestModel) {
          ws.send(JSON.stringify({ requestId, data: { requests: [], inboxEnabled: false } }));
          break;
        }
        const where = { adapter: String(adapter), bot_id: String(botId) };
        const limitNum = Math.min(Number(limit) || 30, 100);
        const offsetNum = Math.max(0, Number(offset) || 0);
        let q = RequestModel.select().where(where).orderBy("created_at", "DESC").limit(limitNum).offset(offsetNum);
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
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:inboxNotices": {
      try {
        const d = message.data || {};
        const { adapter, botId, limit = 30, offset = 0 } = d;
        if (!adapter || !botId) {
          ws.send(JSON.stringify({ requestId, error: "adapter and botId required" }));
          break;
        }
        let db: DatabaseFeature;
        try {
          db = root.inject("database") as DatabaseFeature;
        } catch {
          ws.send(JSON.stringify({ requestId, data: { notices: [], inboxEnabled: false } }));
          break;
        }
        const NoticeModel = db?.models?.get("unified_inbox_notice") as any;
        if (!NoticeModel) {
          ws.send(JSON.stringify({ requestId, data: { notices: [], inboxEnabled: false } }));
          break;
        }
        const where = { adapter: String(adapter), bot_id: String(botId) };
        const limitNum = Math.min(Number(limit) || 30, 100);
        const offsetNum = Math.max(0, Number(offset) || 0);
        let q = NoticeModel.select().where(where).orderBy("created_at", "DESC").limit(limitNum).offset(offsetNum);
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
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "bot:groupMembers":
    case "bot:groupKick":
    case "bot:groupMute":
    case "bot:groupAdmin": {
      try {
        const d = message.data || {};
        const { adapter, botId, groupId, userId, duration, enable } = d;
        if (!adapter || !botId || !groupId) {
          ws.send(
            JSON.stringify({ requestId, error: "adapter, botId, groupId required" })
          );
          break;
        }
        const ad = root.inject(adapter as keyof Plugin.Contexts) as any;
        if (!ad) {
          ws.send(JSON.stringify({ requestId, error: "adapter not found" }));
          break;
        }
        const gid = String(groupId);
        if (type === "bot:groupMembers") {
          if (typeof ad.listMembers !== "function") {
            ws.send(JSON.stringify({ requestId, error: "adapter does not support listMembers" }));
            break;
          }
          const r = await ad.listMembers(botId, gid);
          ws.send(JSON.stringify({ requestId, data: r }));
        } else if (type === "bot:groupKick") {
          if (!userId) {
            ws.send(JSON.stringify({ requestId, error: "userId required" }));
            break;
          }
          if (typeof ad.kickMember !== "function") {
            ws.send(JSON.stringify({ requestId, error: "adapter does not support kickMember" }));
            break;
          }
          await ad.kickMember(botId, gid, String(userId));
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        } else if (type === "bot:groupMute") {
          if (!userId) {
            ws.send(JSON.stringify({ requestId, error: "userId required" }));
            break;
          }
          if (typeof ad.muteMember !== "function") {
            ws.send(JSON.stringify({ requestId, error: "adapter does not support muteMember" }));
            break;
          }
          await ad.muteMember(botId, gid, String(userId), duration ?? 600);
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        } else {
          if (!userId) {
            ws.send(JSON.stringify({ requestId, error: "userId required" }));
            break;
          }
          if (typeof ad.setAdmin !== "function") {
            ws.send(JSON.stringify({ requestId, error: "adapter does not support setAdmin" }));
            break;
          }
          await ad.setAdmin(botId, gid, String(userId), enable !== false);
          ws.send(JSON.stringify({ requestId, data: { success: true } }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    // ================================================================
    // 系统管理
    // ================================================================

    case "system:restart": {
      try {
        logger.info("[console] 收到重启请求，准备重启进程...");
        ws.send(JSON.stringify({ requestId, data: { success: true, message: "正在重启..." } }));
        // 广播给所有客户端
        broadcastToAll(webServer, { type: "system:restarting" });
        // 延迟 500ms 让 WebSocket 消息发出，然后用 exit code 51 触发 CLI 守护进程重启
        setTimeout(() => {
          process.exit(51);
        }, 500);
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    // ================================================================
    // 定时任务管理
    // ================================================================

    case "cron:list": {
      try {
        const m = getCronManager();
        if (!m) {
          ws.send(JSON.stringify({ requestId, error: "定时任务服务不可用（Agent 未初始化）" }));
          break;
        }
        const memory = m.cronFeature.getStatus().map((s) => ({
          type: "memory" as const,
          expression: s.expression,
          running: s.running,
          nextExecution: s.nextExecution?.toISOString() ?? null,
          plugin: s.plugin,
        }));
        const persistent = m.engine
          ? (await m.engine.listJobs()).map((j) => ({
              type: "persistent" as const,
              ...j,
            }))
          : [];
        ws.send(JSON.stringify({ requestId, data: { memory, persistent } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "cron:add": {
      try {
        const m = getCronManager();
        if (!m?.engine) {
          ws.send(JSON.stringify({ requestId, error: "持久化定时任务引擎不可用" }));
          break;
        }
        const { cronExpression, prompt, label, context: cronContext } = message as any;
        if (!cronExpression || !prompt) {
          ws.send(JSON.stringify({ requestId, error: "缺少 cronExpression 或 prompt" }));
          break;
        }
        const record = await m.engine.addJob({
          id: generateCronJobId(),
          cronExpression,
          prompt,
          label: label || undefined,
          enabled: true,
          context: cronContext || undefined,
        });
        ws.send(JSON.stringify({ requestId, data: record }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "cron:remove": {
      try {
        const m = getCronManager();
        if (!m?.engine) {
          ws.send(JSON.stringify({ requestId, error: "持久化定时任务引擎不可用" }));
          break;
        }
        const { id } = message as any;
        if (!id) {
          ws.send(JSON.stringify({ requestId, error: "缺少任务 id" }));
          break;
        }
        const ok = await m.engine.removeJob(id);
        ws.send(JSON.stringify({ requestId, data: { success: ok } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "cron:pause": {
      try {
        const m = getCronManager();
        if (!m?.engine) {
          ws.send(JSON.stringify({ requestId, error: "持久化定时任务引擎不可用" }));
          break;
        }
        const { id } = message as any;
        if (!id) {
          ws.send(JSON.stringify({ requestId, error: "缺少任务 id" }));
          break;
        }
        const ok = await m.engine.pauseJob(id);
        ws.send(JSON.stringify({ requestId, data: { success: ok } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

    case "cron:resume": {
      try {
        const m = getCronManager();
        if (!m?.engine) {
          ws.send(JSON.stringify({ requestId, error: "持久化定时任务引擎不可用" }));
          break;
        }
        const { id } = message as any;
        if (!id) {
          ws.send(JSON.stringify({ requestId, error: "缺少任务 id" }));
          break;
        }
        const ok = await m.engine.resumeJob(id);
        ws.send(JSON.stringify({ requestId, data: { success: ok } }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: (error as Error).message }));
      }
      break;
    }

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
  const model = db.models.get(table as any);
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
  const model = db.models.get(table as any);
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
  const model = db.models.get(table as any);
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
  const model = db.models.get(table as any);
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
  const model = db.models.get(table as any);
  if (!model) throw new Error(`Table '${table}' not found`);
  const sql = db.dialect.formatDropTable(table, true);
  await db.query(sql);
  db.models.delete(table as any);
  db.definitions.delete(table as any);
}

// KV 专用操作
async function kvGet(table: string, key: string) {
  const dbFeature = getDb();
  const model = dbFeature.db.models.get(table as any) as any;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  return await model.get(key);
}

async function kvSet(table: string, key: string, value: any, ttl?: number) {
  const dbFeature = getDb();
  const model = dbFeature.db.models.get(table as any) as any;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  await model.set(key, value, ttl);
}

async function kvDelete(table: string, key: string) {
  const dbFeature = getDb();
  const model = dbFeature.db.models.get(table as any) as any;
  if (!model) throw new Error(`Bucket '${table}' not found`);
  await model.deleteByKey(key);
}

async function kvGetEntries(table: string) {
  const dbFeature = getDb();
  const model = dbFeature.db.models.get(table as any) as any;
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
  for (const child of rootPlugin.children) {
    if (child.name === configKey || child.name.endsWith(`-${configKey}`) || child.name.includes(configKey)) {
      return child;
    }
    const found = findPluginByConfigKey(child, configKey);
    if (found) return found;
  }
  return null;
}

export function broadcastToAll(webServer: WebServer, message: any) {
  for (const ws of webServer.ws.clients || []) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

export function notifyDataUpdate(webServer: WebServer) {
  broadcastToAll(webServer, { type: "data-update", timestamp: Date.now() });
}
