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
