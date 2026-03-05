import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { Plugin, usePlugin } from "@zhin.js/core";
import type { SchemaFeature, ConfigFeature } from "@zhin.js/core";
import type { WebServer } from "./index.js";

const { root, logger } = usePlugin();

const ENV_WHITELIST = [".env", ".env.development", ".env.production"];

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

    default:
      ws.send(JSON.stringify({ requestId, error: `Unknown message type: ${type}` }));
  }
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
