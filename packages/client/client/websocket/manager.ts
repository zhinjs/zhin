/**
 * WebSocket 核心管理器
 * 负责 WebSocket 连接管理、消息发送、重连逻辑等核心功能
 */

import { store, setConnected, updateConfigs, updateSchemas } from '../store'
import { MessageHandler } from './messageHandler'
import type {
  WebSocketMessage,
  WebSocketConfig,
  WebSocketCallbacks
} from './types'
import {
  ConnectionState,
  WebSocketError,
  ConnectionError,
  MessageError,
  RequestTimeoutError
} from './types'

export class WebSocketManager {
  // ============================================================================
  // 私有属性
  // ============================================================================
  
  private ws: WebSocket | null = null
  private config: Required<WebSocketConfig>
  private callbacks: WebSocketCallbacks
  private state: ConnectionState = ConnectionState.DISCONNECTED
  
  // 重连相关
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  
  // 请求管理
  private requestId = 0
  private pendingRequests = new Map<number, { 
    resolve: (value: any) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()

  // ============================================================================
  // 构造函数
  // ============================================================================

  constructor(config: WebSocketConfig = {}, callbacks: WebSocketCallbacks = {}) {
    this.config = {
      url: this.buildWebSocketUrl(config.url),
      reconnectInterval: config.reconnectInterval ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      requestTimeout: config.requestTimeout ?? 10000
    }
    this.callbacks = callbacks
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 建立 WebSocket 连接
   */
  connect(): void {
    if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
      return
    }

    this.setState(ConnectionState.CONNECTING)
    
    try {
      this.ws = new WebSocket(this.config.url)
      this.attachEventHandlers()
    } catch (error) {
      this.handleConnectionError(new ConnectionError('Failed to create WebSocket', error as Error))
    }
  }

  /**
   * 断开 WebSocket 连接
   */
  disconnect(): void {
    this.clearReconnectTimer()
    this.clearPendingRequests()
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    
    this.setState(ConnectionState.DISCONNECTED)
    store.dispatch(setConnected(false))
  }

  /**
   * 发送普通消息
   */
  send(message: any): void {
    if (!this.isConnected()) {
      throw new WebSocketError('WebSocket is not connected', 'NOT_CONNECTED')
    }

    try {
      this.ws!.send(JSON.stringify(message))
    } catch (error) {
      throw new MessageError('Failed to send message', error as Error)
    }
  }

  /**
   * 发送请求并等待响应
   */
  async sendRequest<T = any>(message: any): Promise<T> {
    if (!this.isConnected()) {
      throw new WebSocketError('WebSocket is not connected', 'NOT_CONNECTED')
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId
      const messageWithId = { ...message, requestId }
      
      // 设置超时计时器
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new RequestTimeoutError(requestId))
      }, this.config.requestTimeout)

      // 存储请求信息
      this.pendingRequests.set(requestId, { resolve, reject, timer })

      try {
        this.ws!.send(JSON.stringify(messageWithId))
      } catch (error) {
        this.pendingRequests.delete(requestId)
        clearTimeout(timer)
        reject(new MessageError('Failed to send request', error as Error))
      }
    })
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * 获取当前状态
   */
  getState(): ConnectionState {
    return this.state
  }

  // ============================================================================
  // 配置管理 API
  // ============================================================================

  /**
   * 获取插件配置
   */
  async getConfig(pluginName: string): Promise<any> {
    return this.sendRequest({
      type: 'config:get',
      pluginName
    })
  }

  /**
   * 设置插件配置
   */
  async setConfig(pluginName: string, config: any): Promise<void> {
    await this.sendRequest({
      type: 'config:set',
      pluginName,
      data: config
    })
  }

  /**
   * 获取插件 Schema
   */
  async getSchema(pluginName: string): Promise<any> {
    return this.sendRequest({
      type: 'schema:get',
      pluginName
    })
  }

  /**
   * 获取所有配置
   */
  async getAllConfigs(): Promise<Record<string, any>> {
    return this.sendRequest({
      type: 'config:get-all'
    })
  }

  /**
   * 获取所有 Schema
   */
  async getAllSchemas(): Promise<Record<string, any>> {
    return this.sendRequest({
      type: 'schema:get-all'
    })
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 构建 WebSocket URL
   */
  private buildWebSocketUrl(customUrl?: string): string {
    if (customUrl) {
      return customUrl
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/server`
  }

  /**
   * 设置连接状态
   */
  private setState(newState: ConnectionState): void {
    const oldState = this.state
    this.state = newState
    
    console.debug(`[WebSocket] State changed: ${oldState} -> ${newState}`)
  }

  /**
   * 绑定事件处理器
   */
  private attachEventHandlers(): void {
    if (!this.ws) return

    this.ws.onopen = () => {
      this.handleConnectionOpen()
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event)
    }

    this.ws.onclose = (event) => {
      this.handleConnectionClose(event)
    }

    this.ws.onerror = (event) => {
      this.handleConnectionError(new ConnectionError('WebSocket error', event as any))
    }
  }

  /**
   * 处理连接打开
   */
  private handleConnectionOpen(): void {
    this.setState(ConnectionState.CONNECTED)
    this.reconnectAttempts = 0
    
    // 更新 Redux 状态
    store.dispatch(setConnected(true))
    
    // 初始化数据
    this.initializeData()
    
    // 触发回调
    this.callbacks.onConnect?.()
  }

  /**
   * 处理消息接收
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message: WebSocketMessage = JSON.parse(event.data)
      
      // 处理请求响应
      if (message.requestId && this.pendingRequests.has(message.requestId)) {
        this.handleRequestResponse(message)
        return
      }

      // 处理广播消息
      MessageHandler.handle(message)
      this.callbacks.onMessage?.(message)
      
    } catch (error) {
      console.error('[WebSocket] Message parsing error:', error)
    }
  }

  /**
   * 处理请求响应
   */
  private handleRequestResponse(message: any): void {
    const { requestId } = message
    const pendingRequest = this.pendingRequests.get(requestId)
    
    if (!pendingRequest) {
      return
    }

    this.pendingRequests.delete(requestId)
    clearTimeout(pendingRequest.timer)

    if (message.error) {
      pendingRequest.reject(new WebSocketError(message.error, 'SERVER_ERROR'))
    } else {
      pendingRequest.resolve(message.data)
    }
  }

  /**
   * 处理连接关闭
   */
  private handleConnectionClose(event: CloseEvent): void {
    this.ws = null
    store.dispatch(setConnected(false))
    
    if (this.state === ConnectionState.DISCONNECTED) {
      // 主动断开，不重连
      return
    }

    this.setState(ConnectionState.RECONNECTING)
    this.callbacks.onDisconnect?.()
    this.scheduleReconnect()
  }

  /**
   * 处理连接错误
   */
  private handleConnectionError(error: Error): void {
    this.clearReconnectTimer()
    this.setState(ConnectionState.ERROR)
    console.error('[WebSocket] Connection error:', error)
    this.callbacks.onError?.(error as any)
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached')
      this.setState(ConnectionState.ERROR)
      return
    }

    this.reconnectAttempts++
    const delay = this.config.reconnectInterval * this.reconnectAttempts

    console.debug(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      if (this.state === ConnectionState.RECONNECTING) {
        this.connect()
      }
    }, delay)
  }

  /**
   * 清除重连计时器
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * 清除所有待处理请求
   */
  private clearPendingRequests(): void {
    for (const [requestId, { reject, timer }] of this.pendingRequests) {
      clearTimeout(timer)
      reject(new WebSocketError('Connection closed', 'CONNECTION_CLOSED'))
    }
    this.pendingRequests.clear()
  }

  /**
   * 初始化数据
   */
  private async initializeData(): Promise<void> {
    try {
      // 并行获取所有配置和 Schema
      const [configs, schemas] = await Promise.all([
        this.getAllConfigs().catch(error => {
          console.warn('[WebSocket] Failed to load configs:', error)
          return {}
        }),
        this.getAllSchemas().catch(error => {
          console.warn('[WebSocket] Failed to load schemas:', error)
          return {}
        })
      ])

      // 更新 Redux 状态
      store.dispatch(updateConfigs(configs))
      store.dispatch(updateSchemas(schemas))
      
    } catch (error) {
      console.error('[WebSocket] Data initialization failed:', error)
    }
  }
}