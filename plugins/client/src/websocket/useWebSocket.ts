import { useCallback } from 'react'
import { useSelector } from '../store'
import { getWebSocketManager } from './index'

/**
 * WebSocket Hook
 * 用于在 React 组件中访问 WebSocket 状态和方法
 * WebSocket 在模块加载时已自动连接，无需手动初始化
 * 状态由 Redux store 管理
 */
export function useWebSocket() {
    // 从 Redux 读取状态
    const entries = useSelector((state: any) => state.script.entries || [])
    const loadedScripts = useSelector((state: any) => state.script.loadedScripts || [])

    const connect = useCallback(() => {
        getWebSocketManager().connect()
    }, [])

    const disconnect = useCallback(() => {
        getWebSocketManager().disconnect()
    }, [])

    const send = useCallback((message: any) => {
        getWebSocketManager().send(message)
    }, [])

    const isConnected = useCallback(() => {
        return getWebSocketManager().isConnected()
    }, [])

    return {
        entries,
        loadedScripts,
        connect,
        disconnect,
        send,
        isConnected
    }
}

export default useWebSocket
