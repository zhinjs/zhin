/**
 * WebSocket React Hooks
 * 提供在 React 组件中使用 WebSocket 功能的便捷接口
 */

import { useCallback, useEffect, useMemo } from 'react'
import { 
  useSelector, 
  useDispatch,
  selectConfig,
  selectSchema,
  selectConfigLoading,
  selectConfigError,
  selectConfigConnected,
  selectAllConfigs,
  selectAllSchemas,
  setLoading,
  setError
} from '../store'
import { getWebSocketManager } from './instance'
import type { UseConfigOptions, UseWebSocketOptions } from './types'

// ============================================================================
// WebSocket 连接 Hook
// ============================================================================

/**
 * WebSocket 连接状态和基础功能 Hook
 */
export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { autoConnect = true } = options
  
  const wsManager = getWebSocketManager()
  
  // 从 Redux 获取状态
  const connected = useSelector(selectConfigConnected)
  const entries = useSelector((state: any) => state.script?.entries || [])
  const loadedScripts = useSelector((state: any) => state.script?.loadedScripts || [])

  // 连接控制
  const connect = useCallback(() => {
    wsManager.connect()
  }, [wsManager])

  const disconnect = useCallback(() => {
    wsManager.disconnect()
  }, [wsManager])

  // 消息发送
  const send = useCallback((message: any) => {
    wsManager.send(message)
  }, [wsManager])

  const sendRequest = useCallback(async <T = any>(message: any): Promise<T> => {
    // 临时使用旧方法，后续完善
    return (wsManager as any).sendRequest(message)
  }, [wsManager])

  // 状态查询
  const isConnected = useCallback(() => {
    return wsManager.isConnected()
  }, [wsManager])

  const getState = useCallback(() => {
    // 临时返回连接状态，后续完善
    return wsManager.isConnected() ? 'connected' : 'disconnected'
  }, [wsManager])

  // 自动连接
  useEffect(() => {
    if (autoConnect && !connected) {
      connect()
    }
  }, [autoConnect, connected, connect])

  return {
    // 状态
    connected,
    entries,
    loadedScripts,
    
    // 方法
    connect,
    disconnect,
    send,
    sendRequest,
    isConnected,
    getState,
    
    // WebSocket 实例（高级用法）
    manager: wsManager
  }
}

// ============================================================================
// 配置管理 Hook
// ============================================================================

/**
 * 插件配置管理 Hook
 */
export function useConfig(pluginName: string, options: UseConfigOptions = {}) {
  const { autoLoad = true, autoLoadSchema = true } = options
  
  const dispatch = useDispatch()
  const wsManager = getWebSocketManager()

  // 状态选择器
  const config = useSelector((state: any) => selectConfig(state, pluginName))
  const schema = useSelector((state: any) => selectSchema(state, pluginName))
  const loading = useSelector((state: any) => selectConfigLoading(state, pluginName))
  const error = useSelector((state: any) => selectConfigError(state, pluginName))
  const connected = useSelector(selectConfigConnected)

  // 配置操作
  const getConfig = useCallback(async () => {
    dispatch(setLoading({ pluginName, loading: true }))
    dispatch(setError({ pluginName, error: null }))

    try {
      const result = await wsManager.getConfig(pluginName)
      return result
    } catch (error) {
      console.error('[useConfig] getConfig failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      dispatch(setError({ pluginName, error: errorMessage }))
      throw error
    } finally {
      dispatch(setLoading({ pluginName, loading: false }))
    }
  }, [pluginName, wsManager, dispatch])

  const setConfig = useCallback(async (newConfig: any) => {
    dispatch(setLoading({ pluginName, loading: true }))
    dispatch(setError({ pluginName, error: null }))

    try {
      await wsManager.setConfig(pluginName, newConfig)
    } catch (error) {
      console.error('[useConfig] setConfig failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      dispatch(setError({ pluginName, error: errorMessage }))
      throw error
    } finally {
      dispatch(setLoading({ pluginName, loading: false }))
    }
  }, [pluginName, wsManager, dispatch])

  const getSchema = useCallback(async () => {
    try {
      return await wsManager.getSchema(pluginName)
    } catch (error) {
      console.error(`Failed to get schema for plugin ${pluginName}:`, error)
      throw error
    }
  }, [pluginName, wsManager])

  // 重新加载配置和 Schema
  const reload = useCallback(async () => {
    const promises = []
    
    if (autoLoad) {
      promises.push(getConfig())
    }
    
    if (autoLoadSchema) {
      promises.push(getSchema())
    }
    
    await Promise.all(promises)
  }, [autoLoad, autoLoadSchema, getConfig, getSchema])

  // 自动加载
  useEffect(() => {
    if (connected && autoLoad && !config && !loading) {
      getConfig().catch(console.error)
    }
  }, [connected, autoLoad, config, loading, getConfig])

  useEffect(() => {
    if (connected && autoLoadSchema && !schema) {
      getSchema().catch(console.error)
    }
  }, [connected, autoLoadSchema, schema, getSchema])

  return useMemo(() => ({
    // 状态
    config,
    schema,
    loading,
    error,
    connected,
    
    // 方法
    getConfig,
    setConfig,
    getSchema,
    reload
  }), [config, schema, loading, error, connected, getConfig, setConfig, getSchema, reload])
}

// ============================================================================
// 批量配置管理 Hook
// ============================================================================

/**
 * 所有配置管理 Hook
 */
export function useAllConfigs() {
  const wsManager = getWebSocketManager()
  
  const allConfigs = useSelector(selectAllConfigs)
  const allSchemas = useSelector(selectAllSchemas)
  const connected = useSelector(selectConfigConnected)

  const refreshAll = useCallback(async () => {
    try {
      const [configs, schemas] = await Promise.all([
        (wsManager as any).getAllConfigs(),
        (wsManager as any).getAllSchemas()
      ])
      
      return { configs, schemas }
    } catch (error) {
      console.error('Failed to refresh all configs:', error)
      throw error
    }
  }, [wsManager])

  return useMemo(() => ({
    configs: allConfigs,
    schemas: allSchemas,
    connected,
    refreshAll
  }), [allConfigs, allSchemas, connected, refreshAll])
}
