/**
 * WebSocket React Hooks
 * 提供在 React 组件中使用 WebSocket 功能的便捷接口
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  setError,
  updateConfig,
  updateSchema
} from '../store'
import { getWebSocketManager } from './instance'
import type { UseConfigOptions, UseWebSocketOptions, FileTreeNode, DatabaseInfo, TableInfo, SelectResult, KvEntry, DatabaseType } from './types'

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
      dispatch(updateConfig({ pluginName, config: result }))
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

  const setConfig = useCallback(async (newConfig: any): Promise<{ reloaded?: boolean; message?: string }> => {
    dispatch(setLoading({ pluginName, loading: true }))
    dispatch(setError({ pluginName, error: null }))

    try {
      const result = await wsManager.setConfig(pluginName, newConfig)
      return { reloaded: result?.reloaded, message: result?.message }
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
      const result = await wsManager.getSchema(pluginName)
      if (result) {
        dispatch(updateSchema({ pluginName, schema: result }))
      }
      return result
    } catch (error) {
      console.error(`Failed to get schema for plugin ${pluginName}:`, error)
      throw error
    }
  }, [pluginName, wsManager, dispatch])

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

// ============================================================================
// 配置文件 YAML 读写 Hook
// ============================================================================

export function useConfigYaml() {
  const wsManager = getWebSocketManager()
  const connected = useSelector(selectConfigConnected)

  const [yaml, setYaml] = useState('')
  const [pluginKeys, setPluginKeys] = useState<string[]>([])
  const [loading, setLoadingState] = useState(false)
  const [error, setErrorState] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadingState(true)
    setErrorState(null)
    try {
      const result = await wsManager.getConfigYaml()
      setYaml(result.yaml)
      setPluginKeys(result.pluginKeys)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    } finally {
      setLoadingState(false)
    }
  }, [wsManager])

  const save = useCallback(async (content: string) => {
    setLoadingState(true)
    setErrorState(null)
    try {
      const result = await wsManager.saveConfigYaml(content)
      setYaml(content)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    } finally {
      setLoadingState(false)
    }
  }, [wsManager])

  useEffect(() => {
    if (connected && !yaml && !loading) {
      load().catch(() => {})
    }
  }, [connected, yaml, loading, load])

  return useMemo(() => ({
    yaml, pluginKeys, loading, error, load, save
  }), [yaml, pluginKeys, loading, error, load, save])
}

// ============================================================================
// 环境变量文件管理 Hook
// ============================================================================

export function useEnvFiles() {
  const wsManager = getWebSocketManager()
  const connected = useSelector(selectConfigConnected)

  const [files, setFiles] = useState<Array<{ name: string; exists: boolean }>>([])
  const [loading, setLoadingState] = useState(false)
  const [error, setErrorState] = useState<string | null>(null)

  const listFiles = useCallback(async () => {
    setLoadingState(true)
    setErrorState(null)
    try {
      const result = await wsManager.getEnvList()
      setFiles(result.files)
      return result.files
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    } finally {
      setLoadingState(false)
    }
  }, [wsManager])

  const getFile = useCallback(async (filename: string) => {
    try {
      const result = await wsManager.getEnvFile(filename)
      return result.content
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const saveFile = useCallback(async (filename: string, content: string) => {
    setLoadingState(true)
    setErrorState(null)
    try {
      return await wsManager.saveEnvFile(filename, content)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    } finally {
      setLoadingState(false)
    }
  }, [wsManager])

  useEffect(() => {
    if (connected && files.length === 0 && !loading) {
      listFiles().catch(() => {})
    }
  }, [connected, files.length, loading, listFiles])

  return useMemo(() => ({
    files, loading, error, listFiles, getFile, saveFile
  }), [files, loading, error, listFiles, getFile, saveFile])
}

// ============================================================================
// 文件管理 Hook
// ============================================================================

export function useFiles() {
  const wsManager = getWebSocketManager()
  const connected = useSelector(selectConfigConnected)

  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [loading, setLoadingState] = useState(false)
  const [error, setErrorState] = useState<string | null>(null)

  const loadTree = useCallback(async () => {
    setLoadingState(true)
    setErrorState(null)
    try {
      const result = await wsManager.getFileTree()
      setTree(result.tree)
      return result.tree
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    } finally {
      setLoadingState(false)
    }
  }, [wsManager])

  const readFile = useCallback(async (filePath: string) => {
    try {
      const result = await wsManager.readFile(filePath)
      return result.content
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const saveFile = useCallback(async (filePath: string, content: string) => {
    setLoadingState(true)
    setErrorState(null)
    try {
      return await wsManager.saveFile(filePath, content)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    } finally {
      setLoadingState(false)
    }
  }, [wsManager])

  useEffect(() => {
    if (connected && tree.length === 0 && !loading) {
      loadTree().catch(() => {})
    }
  }, [connected, tree.length, loading, loadTree])

  return useMemo(() => ({
    tree, loading, error, loadTree, readFile, saveFile
  }), [tree, loading, error, loadTree, readFile, saveFile])
}

// ============================================================================
// 数据库管理 Hook
// ============================================================================

export function useDatabase() {
  const wsManager = getWebSocketManager()
  const connected = useSelector(selectConfigConnected)

  const [info, setInfo] = useState<DatabaseInfo | null>(null)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [loading, setLoadingState] = useState(false)
  const [error, setErrorState] = useState<string | null>(null)

  const loadInfo = useCallback(async () => {
    setLoadingState(true)
    setErrorState(null)
    try {
      const result = await wsManager.getDbInfo()
      setInfo(result)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    } finally {
      setLoadingState(false)
    }
  }, [wsManager])

  const loadTables = useCallback(async () => {
    setLoadingState(true)
    setErrorState(null)
    try {
      const result = await wsManager.getDbTables()
      setTables(result.tables)
      return result.tables
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    } finally {
      setLoadingState(false)
    }
  }, [wsManager])

  const select = useCallback(async (table: string, page?: number, pageSize?: number, where?: any) => {
    try {
      return await wsManager.dbSelect(table, page, pageSize, where)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const insert = useCallback(async (table: string, row: any) => {
    try {
      return await wsManager.dbInsert(table, row)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const update = useCallback(async (table: string, row: any, where: any) => {
    try {
      return await wsManager.dbUpdate(table, row, where)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const remove = useCallback(async (table: string, where: any) => {
    try {
      return await wsManager.dbDelete(table, where)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const dropTable = useCallback(async (table: string) => {
    try {
      const result = await wsManager.dbDropTable(table)
      await loadTables()
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager, loadTables])

  const kvGet = useCallback(async (table: string, key: string) => {
    try {
      return await wsManager.kvGet(table, key)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const kvSet = useCallback(async (table: string, key: string, value: any, ttl?: number) => {
    try {
      return await wsManager.kvSet(table, key, value, ttl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const kvDelete = useCallback(async (table: string, key: string) => {
    try {
      return await wsManager.kvDelete(table, key)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  const kvEntries = useCallback(async (table: string) => {
    try {
      return await wsManager.kvGetEntries(table)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorState(msg)
      throw err
    }
  }, [wsManager])

  useEffect(() => {
    if (connected && !info && !loading) {
      loadInfo().catch(() => {})
      loadTables().catch(() => {})
    }
  }, [connected, info, loading, loadInfo, loadTables])

  return useMemo(() => ({
    info, tables, loading, error,
    loadInfo, loadTables, dropTable,
    select, insert, update, remove,
    kvGet, kvSet, kvDelete, kvEntries,
  }), [info, tables, loading, error, loadInfo, loadTables, dropTable, select, insert, update, remove, kvGet, kvSet, kvDelete, kvEntries])
}
