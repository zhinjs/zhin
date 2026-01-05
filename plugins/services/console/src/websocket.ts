import WebSocket from "ws";
import { Plugin, usePlugin } from "@zhin.js/core";
import type { WebServer } from "./index.js";

const { root, logger } = usePlugin();

/**
 * 设置 WebSocket 连接处理
 */
export function setupWebSocket(webServer: WebServer) {
  webServer.ws.on("connection", (ws: WebSocket) => {
    // 发送初始数据同步
    ws.send(
      JSON.stringify({
        type: "sync",
        data: {
          key: "entries",
          value: Object.values(webServer.entries),
        },
      })
    );

    // 通知客户端进行数据初始化
    ws.send(
      JSON.stringify({
        type: "init-data",
        timestamp: Date.now(),
      })
    );

    // 处理客户端消息
    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(ws, message, webServer);
      } catch (error) {
        console.error("WebSocket 消息处理错误:", error);
        ws.send(
          JSON.stringify({
            error: "Invalid message format",
          })
        );
      }
    });

    ws.on("close", () => {
      // 连接关闭时的清理工作
    });

    ws.on("error", (error) => {
      console.error("WebSocket 错误:", error);
    });
  });
}

/**
 * 处理 WebSocket 消息
 */
async function handleWebSocketMessage(
  ws: WebSocket,
  message: any,
  webServer: WebServer
) {
  const { type, requestId, pluginName } = message;

  switch (type) {
    case "ping":
      // 心跳检测
      ws.send(JSON.stringify({ type: "pong", requestId }));
      break;

    case "entries:get":
      // 获取所有入口文件
      ws.send(
        JSON.stringify({
          requestId,
          data: Object.values(webServer.entries),
        })
      );
      break;

    case "config:get":
      // 获取插件配置
      try {
        const configService = root.inject('config')!;
        const appConfig = configService.get<Record<string, any>>('zhin.config.yml');
        const config = pluginName ? (appConfig[pluginName] || {}) : appConfig;
        ws.send(JSON.stringify({ requestId, data: config }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get config: ${(error as Error).message}` }));
      }
      break;

    case "config:get-all":
      // 获取所有配置
      try {
        const configService = root.inject('config')!;
        const appConfig = configService.get<Record<string, any>>('zhin.config.yml');
        ws.send(JSON.stringify({ requestId, data: appConfig }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get all configs: ${(error as Error).message}` }));
      }
      break;

    case "config:set":
      // 设置插件配置
      try {
        const { data } = message;
        if (!pluginName) {
          ws.send(JSON.stringify({ requestId, error: 'Plugin name is required' }));
          break;
        }
        const configService = root.inject('config')!;
        const appConfig = configService.get<Record<string, any>>('zhin.config.yml');
        appConfig[pluginName] = data;
        configService.set('zhin.config.yml', appConfig);
        ws.send(JSON.stringify({ requestId, success: true }));
        
        // 广播配置更新
        broadcastToAll(webServer, {
          type: 'config:updated',
          data: { pluginName, config: data }
        });
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to set config: ${(error as Error).message}` }));
      }
      break;

    case "schema:get":
      // 获取插件 Schema
      try {
        const schemaService = root.inject('schema' as any);
        const schema = pluginName && schemaService ? (schemaService as any).get(pluginName) : null;
        if (schema) {
          ws.send(JSON.stringify({ requestId, data: schema.toJSON() }));
        } else {
          ws.send(JSON.stringify({ requestId, data: null }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get schema: ${(error as Error).message}` }));
      }
      break;

    case "schema:get-all":
      // 获取所有插件 Schema
      try {
        const schemaService = root.inject('schema' as any);
        const schemas: Record<string, any> = {};
        if (schemaService) {
          for (const [name, schema] of (schemaService as any).items.entries()) {
            schemas[name] = schema.toJSON();
          }
        }
        ws.send(JSON.stringify({ requestId, data: schemas }));
      } catch (error) {
        ws.send(JSON.stringify({ requestId, error: `Failed to get all schemas: ${(error as Error).message}` }));
      }
      break;

    default:
      // 未知消息类型
      ws.send(
        JSON.stringify({
          requestId,
          error: `Unknown message type: ${type}`,
        })
      );
  }
}

/**
 * 广播消息给所有连接的客户端
 */
export function broadcastToAll(webServer: WebServer, message: any) {
  for (const ws of webServer.ws.clients || []) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

/**
 * 通知数据更新
 */
export function notifyDataUpdate(webServer: WebServer) {
  broadcastToAll(webServer, {
    type: "data-update",
    timestamp: Date.now(),
  });
}
