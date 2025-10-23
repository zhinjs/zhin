/**
 * WebSocket 实例管理
 * 提供全局 WebSocket 管理器单例
 */

import { WebSocketManager } from './manager'

// ============================================================================
// 全局实例
// ============================================================================

let globalWebSocketManager: WebSocketManager | null = null

/**
 * 获取全局 WebSocket 管理器实例
 */
export function getWebSocketManager(): WebSocketManager {
  if (!globalWebSocketManager) {
    globalWebSocketManager = new WebSocketManager()
    
    // 浏览器环境下自动连接
    if (typeof window !== 'undefined') {
      globalWebSocketManager.connect()
    }
  }
  
  return globalWebSocketManager
}

/**
 * 销毁全局 WebSocket 管理器
 */
export function destroyWebSocketManager(): void {
  if (globalWebSocketManager) {
    globalWebSocketManager.disconnect()
    globalWebSocketManager = null
  }
}

/**
 * 重置 WebSocket 管理器（主要用于测试）
 */
export function resetWebSocketManager(): void {
  destroyWebSocketManager()
  // 下次调用 getWebSocketManager() 时会创建新实例
}