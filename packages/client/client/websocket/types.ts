/**
 * WebSocket 相关类型定义
 */

// ============================================================================
// 基础消息类型
// ============================================================================

export interface BaseMessage {
  type: string
  timestamp?: number
  requestId?: number
  error?: string
}

// ============================================================================
// 脚本管理消息类型
// ============================================================================

export interface ScriptSyncMessage extends BaseMessage {
  type: 'sync'
  data: {
    key: 'entries'
    value: string[]
  }
}

export interface ScriptAddMessage extends BaseMessage {
  type: 'add'
  data: {
    key: 'entries'
    value: string
  }
}

export interface ScriptDeleteMessage extends BaseMessage {
  type: 'delete'
  data: {
    key: 'entries'
    value: string
  }
}

// ============================================================================
// 配置管理消息类型
// ============================================================================

export interface ConfigGetMessage extends BaseMessage {
  type: 'config:get'
  pluginName: string
}

export interface ConfigSetMessage extends BaseMessage {
  type: 'config:set'
  pluginName: string
  data: any
}

export interface ConfigUpdatedMessage extends BaseMessage {
  type: 'config:updated'
  pluginName: string
  data: any
}

export interface ConfigBatchMessage extends BaseMessage {
  type: 'config:batch'
  data: Record<string, any>
}

export interface ConfigErrorMessage extends BaseMessage {
  type: 'config:error'
  pluginName: string
  error: string
}

export interface SchemaGetMessage extends BaseMessage {
  type: 'schema:get'
  pluginName: string
}

export interface SchemaUpdatedMessage extends BaseMessage {
  type: 'schema:updated'
  pluginName: string
  data: any
}

export interface SchemaBatchMessage extends BaseMessage {
  type: 'schema:batch'
  data: Record<string, any>
}

// ============================================================================
// 系统消息类型
// ============================================================================

export interface InitDataMessage extends BaseMessage {
  type: 'init-data'
}

export interface DataUpdateMessage extends BaseMessage {
  type: 'data-update'
}

export interface HmrReloadMessage extends BaseMessage {
  type: 'hmr:reload'
  data?: { file?: string }
}

// ============================================================================
// 联合类型
// ============================================================================

export type WebSocketMessage = 
  | ScriptSyncMessage
  | ScriptAddMessage
  | ScriptDeleteMessage
  | ConfigGetMessage
  | ConfigSetMessage
  | ConfigUpdatedMessage
  | ConfigBatchMessage
  | ConfigErrorMessage
  | SchemaGetMessage
  | SchemaUpdatedMessage
  | SchemaBatchMessage
  | InitDataMessage
  | DataUpdateMessage
  | HmrReloadMessage

// ============================================================================
// 配置选项类型
// ============================================================================

export interface WebSocketConfig {
  /** WebSocket 服务器 URL */
  url?: string
  /** 重连间隔时间（毫秒） */
  reconnectInterval?: number
  /** 最大重连尝试次数 */
  maxReconnectAttempts?: number
  /** 请求超时时间（毫秒） */
  requestTimeout?: number
}

export interface WebSocketCallbacks {
  /** 连接建立回调 */
  onConnect?: () => void
  /** 连接断开回调 */
  onDisconnect?: () => void
  /** 连接错误回调 */
  onError?: (error: Event) => void
  /** 消息接收回调 */
  onMessage?: (message: WebSocketMessage) => void
}

// ============================================================================
// Hook 配置类型
// ============================================================================

export interface UseConfigOptions {
  /** 是否自动加载配置 */
  autoLoad?: boolean
  /** 是否自动加载 Schema */
  autoLoadSchema?: boolean
}

export interface UseWebSocketOptions {
  /** 是否自动连接 */
  autoConnect?: boolean
}

// ============================================================================
// 连接状态枚举
// ============================================================================

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

// ============================================================================
// 错误类型
// ============================================================================

export class WebSocketError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'WebSocketError'
  }
}

export class RequestTimeoutError extends WebSocketError {
  constructor(requestId: number) {
    super(`Request ${requestId} timed out`, 'REQUEST_TIMEOUT')
  }
}

export class ConnectionError extends WebSocketError {
  constructor(message: string, originalError?: Error) {
    super(message, 'CONNECTION_ERROR', originalError)
  }
}

export class MessageError extends WebSocketError {
  constructor(message: string, originalError?: Error) {
    super(message, 'MESSAGE_ERROR', originalError)
  }
}