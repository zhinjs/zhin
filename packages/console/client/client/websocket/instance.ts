import { WebSocketManager } from "./manager";

let globalWebSocketManager: WebSocketManager | null = null;

export function getWebSocketManager(): WebSocketManager {
  if (!globalWebSocketManager) {
    globalWebSocketManager = new WebSocketManager();
    if (typeof window !== "undefined") {
      globalWebSocketManager.connect();
    }
  }
  return globalWebSocketManager;
}

export function destroyWebSocketManager(): void {
  if (globalWebSocketManager) {
    globalWebSocketManager.disconnect();
    globalWebSocketManager = null;
  }
}

export function resetWebSocketManager(): void {
  destroyWebSocketManager();
}
