/**
 * Re-export generic errors from @zhin.js/kernel
 */
export {
  ZhinError,
  ConfigError,
  PluginError,
  ConnectionError,
  ContextError,
  ValidationError,
  PermissionError,
  TimeoutError,
  ErrorManager,
  RetryManager,
  CircuitBreaker,
} from '@zhin.js/kernel';

import { ZhinError } from '@zhin.js/kernel';

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
