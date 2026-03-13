import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { Plugin, usePlugin } from "@zhin.js/core";
import type { SchemaFeature, ConfigFeature, DatabaseFeature } from "@zhin.js/core";
import type { WebServer } from "./index.js";

const { root, logger } = usePlugin();

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
  webServer.ws.on("connection", (ws: WebSocket) => {
    ws.send(JSON.stringify({
      type: "sync",
      data: { key: "entries", value: Object.values(webServer.entries) },
    }));
    ws.send(JSON.stringify({ type: "init-data", timestamp: Date.now() }));

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(ws, message, webServer);
      } catch (error) {
        console.error("WebSocket 消息处理错误:", error);
        ws.send(JSON.stringify({ error: "Invalid message format" }));
      }
    });
    ws.on("close", () => {});
    ws.on("error", (error) => { console.error("WebSocket 错误:", error); });
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
      ws.send(JSON.stringify({ requestId, data: Object.values(webServer.entries) }));
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
