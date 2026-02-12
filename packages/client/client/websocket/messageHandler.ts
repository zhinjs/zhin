/**
 * WebSocket 消息处理器
 * 负责处理不同类型的 WebSocket 消息并分发到对应的处理逻辑
 */

import {
  store,
  syncEntries,
  addEntry,
  removeEntry,
  loadScripts,
  loadScript,
  unloadScript,
  updateConfig,
  updateSchema,
  updateConfigs,
  updateSchemas,
  setError
} from '../store'
import type { WebSocketMessage } from './types'

export class MessageHandler {
  /**
   * 处理 WebSocket 消息
   */
  static handle(message: WebSocketMessage): void {
    try {
      switch (message.type) {
        // 脚本管理相关消息
        case 'sync':
          this.handleScriptSync(message)
          break
        case 'add':
          this.handleScriptAdd(message)
          break
        case 'delete':
          this.handleScriptDelete(message)
          break

        // 配置管理相关消息
        case 'config:updated':
          this.handleConfigUpdated(message)
          break
        case 'config:batch':
          this.handleConfigBatch(message)
          break
        case 'config:error':
          this.handleConfigError(message)
          break

        // Schema 管理相关消息
        case 'schema:updated':
          this.handleSchemaUpdated(message)
          break
        case 'schema:batch':
          this.handleSchemaBatch(message)
          break

        // 轻量 HMR：文件变更时刷新页面
        case 'hmr:reload':
          this.handleHmrReload(message)
          break

        // 系统消息
        case 'init-data':
        case 'data-update':
          this.handleSystemMessage(message)
          break

        default:
          console.warn('[WebSocket] Unknown message type:', message.type)
      }
    } catch (error) {
      console.error('[WebSocket] Message handling error:', error)
    }
  }

  /**
   * 处理脚本同步消息
   */
  private static handleScriptSync(message: any): void {
    if (message.data?.key === 'entries') {
      const entries = Array.isArray(message.data.value) 
        ? message.data.value 
        : [message.data.value]
      
      store.dispatch(syncEntries(entries))
      store.dispatch(loadScripts(entries))
    }
  }

  /**
   * 处理脚本添加消息
   */
  private static handleScriptAdd(message: any): void {
    if (message.data?.key === 'entries') {
      store.dispatch(addEntry(message.data.value))
      store.dispatch(loadScript(message.data.value))
    }
  }

  /**
   * 处理脚本删除消息
   */
  private static handleScriptDelete(message: any): void {
    if (message.data?.key === 'entries') {
      store.dispatch(removeEntry(message.data.value))
      store.dispatch(unloadScript(message.data.value))
    }
  }

  /**
   * 处理配置更新消息
   */
  private static handleConfigUpdated(message: any): void {
    if (message.pluginName && message.data !== undefined) {
      store.dispatch(updateConfig({
        pluginName: message.pluginName,
        config: message.data
      }))
    }
  }

  /**
   * 处理批量配置消息
   */
  private static handleConfigBatch(message: any): void {
    if (message.data) {
      store.dispatch(updateConfigs(message.data))
    }
  }

  /**
   * 处理配置错误消息
   */
  private static handleConfigError(message: any): void {
    if (message.pluginName && message.error) {
      store.dispatch(setError({
        pluginName: message.pluginName,
        error: message.error
      }))
    }
  }

  /**
   * 处理 Schema 更新消息
   */
  private static handleSchemaUpdated(message: any): void {
    if (message.pluginName && message.data !== undefined) {
      store.dispatch(updateSchema({
        pluginName: message.pluginName,
        schema: message.data
      }))
    }
  }

  /**
   * 处理批量 Schema 消息
   */
  private static handleSchemaBatch(message: any): void {
    if (message.data) {
      store.dispatch(updateSchemas(message.data))
    }
  }

  /**
   * 处理轻量 HMR 刷新通知
   * 服务端监听到入口目录文件变更后发送此消息，客户端直接刷新页面
   */
  private static handleHmrReload(message: any): void {
    const file = message.data?.file || ''
    console.info(`[HMR] 文件变更: ${file}，正在刷新页面...`)
    window.location.reload()
  }

  /**
   * 处理系统消息
   */
  private static handleSystemMessage(message: WebSocketMessage): void {
    // 系统消息暂时不需要特殊处理
    // 可以在这里添加系统级别的消息处理逻辑
  }
}