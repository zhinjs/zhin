/**
 * WebSocket 客户端模块
 * 提供统一的 WebSocket 连接管理、消息处理和 React Hook 接口
 */

// ============================================================================
// 类型定义
// ============================================================================
export * from './types'

// ============================================================================
// 核心类
// ============================================================================
export { WebSocketManager } from './manager'
export { MessageHandler } from './messageHandler'

// ============================================================================
// 实例管理
// ============================================================================
export { 
  getWebSocketManager, 
  destroyWebSocketManager, 
  resetWebSocketManager 
} from './instance'

// ============================================================================
// React Hooks
// ============================================================================
export { 
  useWebSocket,
  useConfig,
  useAllConfigs,
  useWebSocketState,
  useWebSocketMessages
} from './hooks'

// ============================================================================
// 向后兼容的导出（保持与旧代码的兼容性）
// ============================================================================

// 为了保持与现有代码的兼容性，重新导出一些常用的接口
import { getWebSocketManager } from './instance'

// 兼容旧的 useConfig 导出
export { useConfig as useConfigLegacy } from './hooks'

// 兼容旧的 WebSocketManager 默认导出
export default getWebSocketManager
