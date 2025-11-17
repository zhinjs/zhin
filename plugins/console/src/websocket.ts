import WebSocket from "ws";
import type { WebServer } from "./index.js";

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
  const { type, requestId } = message;

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
