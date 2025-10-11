import { store, loadScripts, loadScript, unloadScript } from '../store'
/**
 * WebSocket 客户端管理
 * 用于连接服务器并接收动态入口脚本
 * 脚本加载状态由 Redux store 管理
 */

export interface WebSocketMessage {
    type: 'sync' | 'add' | 'delete' | 'init-data' | 'data-update'
    data?: {
        key: string
        value: any
    }
    timestamp?: number
}

export interface WebSocketManagerOptions {
    url?: string
    reconnectInterval?: number
    maxReconnectAttempts?: number
    onConnect?: () => void
    onDisconnect?: () => void
    onError?: (error: Event) => void
    onMessage?: (message: WebSocketMessage) => void
}

export class WebSocketManager {
    private ws: WebSocket | null = null
    private url: string
    private reconnectInterval: number
    private maxReconnectAttempts: number
    private reconnectAttempts = 0
    private reconnectTimer: NodeJS.Timeout | null = null
    private options: WebSocketManagerOptions

    constructor(options: WebSocketManagerOptions = {}) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const host = window.location.host
        
        this.url = options.url || `${protocol}//${host}/server`
        this.reconnectInterval = options.reconnectInterval || 3000
        this.maxReconnectAttempts = options.maxReconnectAttempts || 10
        this.options = options
    }

    /**
     * 连接 WebSocket
     */
    connect() {
        if (this.ws?.readyState === WebSocket.OPEN) return

        try {
            this.ws = new WebSocket(this.url)

            this.ws.onopen = () => {
                this.reconnectAttempts = 0
                this.options.onConnect?.()
            }

            this.ws.onmessage = (event) => {
                try {
                    const message: WebSocketMessage = JSON.parse(event.data)
                    this.handleMessage(message)
                    this.options.onMessage?.(message)
                } catch (error) {
                    console.error('[WS] Parse error:', error)
                }
            }

            this.ws.onclose = () => {
                this.options.onDisconnect?.()
                this.attemptReconnect()
            }

            this.ws.onerror = () => {
                this.options.onError?.(new Event('error'))
            }
        } catch (error) {
            this.attemptReconnect()
        }
    }

    /**
     * 处理服务器消息
     */
    private handleMessage(message: WebSocketMessage) {
        switch (message.type) {
            case 'sync':
                // 同步所有入口 - dispatch 到 Redux
                if (message.data?.key === 'entries') {
                    const entries = Array.isArray(message.data.value) 
                        ? message.data.value 
                        : [message.data.value]
                    store.dispatch({ type: 'script/syncEntries', payload: entries })
                    // 使用 AsyncThunk 加载脚本
                    store.dispatch(loadScripts(entries))
                }
                break

            case 'add':
                // 添加新入口 - dispatch 到 Redux
                if (message.data?.key === 'entries') {
                    store.dispatch({ type: 'script/addEntry', payload: message.data.value })
                    // 使用 AsyncThunk 加载脚本
                    store.dispatch(loadScript(message.data.value))
                }
                break

            case 'delete':
                // 删除入口 - dispatch 到 Redux
                if (message.data?.key === 'entries') {
                    store.dispatch({ type: 'script/removeEntry', payload: message.data.value })
                    // 使用 AsyncThunk 卸载脚本
                    store.dispatch(unloadScript(message.data.value))
                }
                break

            case 'init-data':
            case 'data-update':
                break

            default:
                console.warn('[WS] Unknown type:', message.type)
        }
    }

    /**
     * 尝试重新连接
     */
    private attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) return

        this.reconnectAttempts++
        this.reconnectTimer = setTimeout(() => {
            this.connect()
        }, this.reconnectInterval)
    }

    /**
     * 断开连接
     */
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }

        if (this.ws) {
            this.ws.close()
            this.ws = null
        }
    }

    /**
     * 发送消息
     */
    send(message: any) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message))
        }
    }

    /**
     * 检查是否已连接
     */
    isConnected() {
        return this.ws?.readyState === WebSocket.OPEN
    }
}

// 创建全局单例并自动连接
const globalWebSocketManager = new WebSocketManager()

// 模块加载时自动连接
if (typeof window !== 'undefined') {
    globalWebSocketManager.connect()
}

/**
 * 获取全局 WebSocket 管理器
 */
export function getWebSocketManager(): WebSocketManager {
    return globalWebSocketManager
}

/**
 * 销毁全局 WebSocket 管理器
 */
export function destroyWebSocketManager() {
    globalWebSocketManager.disconnect()
}

export default WebSocketManager
