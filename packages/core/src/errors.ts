// ============================================================================
// 错误处理系统
// ============================================================================

/**
 * 基础错误类，所有自定义错误都应该继承此类
 */
export class ZhinError extends Error {
    public readonly code: string
    public readonly timestamp: Date
    public readonly context?: Record<string, any>

    constructor(message: string, code: string = 'ZHIN_ERROR', context?: Record<string, any>) {
        super(message)
        this.name = this.constructor.name
        this.code = code
        this.timestamp = new Date()
        this.context = context
        
        // 确保错误堆栈正确显示
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor)
        }
    }

    /**
     * 转换为JSON格式
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            timestamp: this.timestamp.toISOString(),
            context: this.context,
            stack: this.stack
        }
    }

    /**
     * 转换为用户友好的格式
     */
    toUserString(): string {
        return `[${this.code}] ${this.message}`
    }
}

/**
 * 配置相关错误
 */
export class ConfigError extends ZhinError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, 'CONFIG_ERROR', context)
    }
}

/**
 * 插件相关错误
 */
export class PluginError extends ZhinError {
    public readonly pluginName: string

    constructor(message: string, pluginName: string, context?: Record<string, any>) {
        super(message, 'PLUGIN_ERROR', { ...context, pluginName })
        this.pluginName = pluginName
    }
}

/**
 * 适配器相关错误
 */
export class AdapterError extends ZhinError {
    public readonly adapterName: string
    public readonly botName?: string

    constructor(message: string, adapterName: string, botName?: string, context?: Record<string, any>) {
        super(message, 'ADAPTER_ERROR', { ...context, adapterName, botName })
        this.adapterName = adapterName
        this.botName = botName
    }
}

/**
 * 连接相关错误
 */
export class ConnectionError extends ZhinError {
    public readonly retryable: boolean

    constructor(message: string, retryable: boolean = true, context?: Record<string, any>) {
        super(message, 'CONNECTION_ERROR', { ...context, retryable })
        this.retryable = retryable
    }
}

/**
 * 消息处理错误
 */
export class MessageError extends ZhinError {
    public readonly messageId?: string
    public readonly channelId?: string

    constructor(message: string, messageId?: string, channelId?: string, context?: Record<string, any>) {
        super(message, 'MESSAGE_ERROR', { ...context, messageId, channelId })
        this.messageId = messageId
        this.channelId = channelId
    }
}

/**
 * 上下文相关错误
 */
export class ContextError extends ZhinError {
    public readonly contextName: string

    constructor(message: string, contextName: string, context?: Record<string, any>) {
        super(message, 'CONTEXT_ERROR', { ...context, contextName })
        this.contextName = contextName
    }
}

/**
 * 验证错误
 */
export class ValidationError extends ZhinError {
    public readonly field?: string
    public readonly value?: any

    constructor(message: string, field?: string, value?: any, context?: Record<string, any>) {
        super(message, 'VALIDATION_ERROR', { ...context, field, value })
        this.field = field
        this.value = value
    }
}

/**
 * 权限错误
 */
export class PermissionError extends ZhinError {
    public readonly userId?: string
    public readonly requiredPermission?: string

    constructor(message: string, userId?: string, requiredPermission?: string, context?: Record<string, any>) {
        super(message, 'PERMISSION_ERROR', { ...context, userId, requiredPermission })
        this.userId = userId
        this.requiredPermission = requiredPermission
    }
}

/**
 * 超时错误
 */
export class TimeoutError extends ZhinError {
    public readonly timeoutMs: number

    constructor(message: string, timeoutMs: number, context?: Record<string, any>) {
        super(message, 'TIMEOUT_ERROR', { ...context, timeoutMs })
        this.timeoutMs = timeoutMs
    }
}

/**
 * 错误处理器接口
 */
export interface ErrorHandler {
    (error: Error, context?: Record<string, any>): void | Promise<void>
}

/**
 * 错误管理器
 */
export class ErrorManager {
    private handlers: Map<string, ErrorHandler[]> = new Map()
    private globalHandlers: ErrorHandler[] = []

    /**
     * 注册错误处理器
     */
    register(errorType: string, handler: ErrorHandler): void {
        if (!this.handlers.has(errorType)) {
            this.handlers.set(errorType, [])
        }
        this.handlers.get(errorType)!.push(handler)
    }

    /**
     * 注册全局错误处理器
     */
    registerGlobal(handler: ErrorHandler): void {
        this.globalHandlers.push(handler)
    }

    /**
     * 处理错误
     */
    async handle(error: Error, context?: Record<string, any>): Promise<void> {
        // 首先调用全局处理器
        for (const handler of this.globalHandlers) {
            try {
                await handler(error, context)
            } catch (handlerError) {
                // console.error 已替换为注释
            }
        }

        // 然后调用特定类型的处理器
        const errorType = error.constructor.name
        const handlers = this.handlers.get(errorType) || []
        
        for (const handler of handlers) {
            try {
                await handler(error, context)
            } catch (handlerError) {
                // console.error 已替换为注释
            }
        }
    }

    /**
     * 移除错误处理器
     */
    unregister(errorType: string, handler: ErrorHandler): boolean {
        const handlers = this.handlers.get(errorType)
        if (handlers) {
            const index = handlers.indexOf(handler)
            if (index !== -1) {
                handlers.splice(index, 1)
                return true
            }
        }
        return false
    }

    /**
     * 清理所有处理器
     */
    clear(): void {
        this.handlers.clear()
        this.globalHandlers.length = 0
    }
}

/**
 * 错误重试工具
 */
export class RetryManager {
    /**
     * 执行重试逻辑
     */
    static async retry<T>(
        fn: () => Promise<T>,
        options: {
            maxRetries?: number
            delay?: number
            exponentialBackoff?: boolean
            retryCondition?: (error: Error) => boolean
        } = {}
    ): Promise<T> {
        const {
            maxRetries = 3,
            delay = 1000,
            exponentialBackoff = true,
            retryCondition = () => true
        } = options

        let lastError: Error
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn()
            } catch (error) {
                lastError = error as Error
                
                // 如果是最后一次尝试或不满足重试条件，直接抛出错误
                if (attempt === maxRetries || !retryCondition(lastError)) {
                    throw lastError
                }
                
                // 计算延迟时间
                const currentDelay = exponentialBackoff 
                    ? delay * Math.pow(2, attempt)
                    : delay
                
                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, currentDelay))
            }
        }
        
        throw lastError!
    }
}

/**
 * 断路器模式实现
 */
export class CircuitBreaker {
    private failures: number = 0
    private lastFailureTime: number = 0
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'

    constructor(
        private failureThreshold: number = 5,
        private timeoutMs: number = 60000,
        private monitoringPeriodMs: number = 10000
    ) {}

    /**
     * 执行受保护的操作
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.timeoutMs) {
                this.state = 'HALF_OPEN'
            } else {
                throw new Error('Circuit breaker is OPEN')
            }
        }

        try {
            const result = await fn()
            this.onSuccess()
            return result
        } catch (error) {
            this.onFailure()
            throw error
        }
    }

    private onSuccess(): void {
        this.failures = 0
        this.state = 'CLOSED'
    }

    private onFailure(): void {
        this.failures++
        this.lastFailureTime = Date.now()
        
        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN'
        }
    }

    /**
     * 获取断路器状态
     */
    getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
        return this.state
    }

    /**
     * 重置断路器
     */
    reset(): void {
        this.failures = 0
        this.lastFailureTime = 0
        this.state = 'CLOSED'
    }
}

// 默认错误管理器实例
export const errorManager = new ErrorManager()

// 默认错误处理器
errorManager.registerGlobal((error, context) => {
    // Default error handler - logs to console
})
