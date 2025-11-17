/**
 * 配置管理 Redux Slice
 * 通过 WebSocket 管理插件配置
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

export interface ConfigState {
  // 所有插件的配置，按插件名分发
  configs: Record<string, any>
  // 所有插件的 Schema，按插件名分发
  schemas: Record<string, any>
  // 加载状态
  loading: Record<string, boolean>
  // 错误信息
  errors: Record<string, string | null>
  // WebSocket 连接状态
  connected: boolean
}

const initialState: ConfigState = {
  configs: {},
  schemas: {},
  loading: {},
  errors: {},
  connected: false
}

// WebSocket 消息类型
export interface ConfigMessage {
  type: 'config:get' | 'config:set' | 'config:updated' | 'schema:get' | 'schema:updated'
  pluginName: string
  data?: any
  error?: string
}

const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    // WebSocket 连接状态
    setConnected: (state, action: PayloadAction<boolean>) => {
      state.connected = action.payload
    },

    // 设置配置加载状态
    setLoading: (state, action: PayloadAction<{ pluginName: string; loading: boolean }>) => {
      const { pluginName, loading } = action.payload
      state.loading[pluginName] = loading
    },

    // 设置错误信息
    setError: (state, action: PayloadAction<{ pluginName: string; error: string | null }>) => {
      const { pluginName, error } = action.payload
      state.errors[pluginName] = error
    },

    // 更新插件配置
    updateConfig: (state, action: PayloadAction<{ pluginName: string; config: any }>) => {
      const { pluginName, config } = action.payload
      state.configs[pluginName] = config
      state.loading[pluginName] = false
      state.errors[pluginName] = null
    },

    // 更新插件 Schema
    updateSchema: (state, action: PayloadAction<{ pluginName: string; schema: any }>) => {
      const { pluginName, schema } = action.payload
      state.schemas[pluginName] = schema
    },

    // 批量更新配置
    updateConfigs: (state, action: PayloadAction<Record<string, any>>) => {
      state.configs = { ...state.configs, ...action.payload }
    },

    // 批量更新 Schema
    updateSchemas: (state, action: PayloadAction<Record<string, any>>) => {
      state.schemas = { ...state.schemas, ...action.payload }
    },

    // 清除插件配置
    removeConfig: (state, action: PayloadAction<string>) => {
      const pluginName = action.payload
      delete state.configs[pluginName]
      delete state.schemas[pluginName]
      delete state.loading[pluginName]
      delete state.errors[pluginName]
    },

    // 清除所有配置
    clearConfigs: (state) => {
      state.configs = {}
      state.schemas = {}
      state.loading = {}
      state.errors = {}
    }
  }
})

export const {
  setConnected,
  setLoading,
  setError,
  updateConfig,
  updateSchema,
  updateConfigs,
  updateSchemas,
  removeConfig,
  clearConfigs
} = configSlice.actions

export default configSlice.reducer

// Selectors
export const selectConfig = (state: { config: ConfigState }, pluginName: string) => 
  state.config.configs[pluginName]

export const selectSchema = (state: { config: ConfigState }, pluginName: string) => 
  state.config.schemas[pluginName]

export const selectConfigLoading = (state: { config: ConfigState }, pluginName: string) => 
  state.config.loading[pluginName] || false

export const selectConfigError = (state: { config: ConfigState }, pluginName: string) => 
  state.config.errors[pluginName] || null

export const selectConfigConnected = (state: { config: ConfigState }) => 
  state.config.connected

export const selectAllConfigs = (state: { config: ConfigState }) => 
  state.config.configs

export const selectAllSchemas = (state: { config: ConfigState }) => 
  state.config.schemas