import { Client } from "kook-client";
import path from "path";
import { 
  Adapter, 
  registerAdapter, 
  Message, 
  segment, 
  usePlugin,
  register,
  useContext
} from "zhin.js";

const plugin = usePlugin();

/**
 * 🎮 KOOK 平台适配器
 * 
 * 基于 kook-client 实现的 Zhin.js 适配器，提供 KOOK 平台的消息收发功能
 */
export class KookBot extends Client {
    $connected;  // 连接状态标记
    $config;     // 适配器配置

    /**
     * 构造函数 - 初始化 KOOK 机器人实例
     * @param {Object} config - KOOK 配置对象
     */
    constructor(config) {
        // 提供默认数据目录配置
        if (!config.data_dir) config.data_dir = path.join(process.cwd(), 'data', 'kook');
        
        // 设置默认配置
        const defaultConfig = {
            timeout: 10000,
            max_retry: 3,
            ignore: 'bot',
            logLevel: 'info'
        };
        
        super(Object.assign({}, defaultConfig, config));
        this.$config = config;
    }

    /**
     * 将 KOOK 原始消息转换为 Zhin.js 标准消息格式
     */
    $formatMessage(msg) {
        const message = Message.from(msg, {
            $id: msg.message_id.toString(),
            $adapter: 'kook',
            $bot: `${this.$config.name}`,
            
            $sender: {
                id: msg.author_id.toString(),
                name: msg.author.info.nickname.toString(),
            },
            
            $channel: {
                id: msg.message_type === 'channel' ? msg.channel_id.toString() : msg.author_id.toString(),
                type: msg.message_type
            },
            
            $content: KookBot.toSegments(msg.message),
            $raw: msg.raw_message,
            
            $timestamp: msg.timestamp,
            
            $recall: async () => {
                await this.$recallMessage(message.$id);
            },
            
            $reply: async (content, quote) => {
                if (!Array.isArray(content)) content = [content];
                
                if (quote) content.unshift({ 
                    type: 'reply', 
                    data: { 
                        id: typeof quote === "boolean" ? message.$id : quote 
                    } 
                });
                
                return await this.$sendMessage({
                    ...message.$channel,
                    context: 'kook',
                    bot: `${this.$config.name}`,
                    content
                });
            }
        });
        
        return message;
    }

    /**
     * 连接方法
     */
    async $connect() {
        try {
            await super.connect();
            
            this.on('message', (m) => this.handleKookMessage(m));
            this.on('error', (error) => this.handleClientError(error));
            
            this.$connected = true;
            this.emit('$connected');
            
            this.#recordConnection('connect');
            
            plugin.logger.info(`KOOK 机器人连接成功: ${this.$config.name}`);
            
            return true;
        } catch (error) {
            this.$connected = false;
            
            plugin.logger.error(`KOOK 机器人连接失败:`, {
                bot: this.$config.name,
                error: error.message
            });
            
            this.emit('$error', error);
            this.#recordConnection('error');
            
            throw this.#wrapConnectionError(error);
        }
    }
    
    /**
     * 断开连接方法
     */
    async $disconnect() {
        try {
            plugin.logger.info(`正在断开 KOOK 机器人连接: ${this.$config.name}`);
            
            await super.disconnect();
            this.$connected = false;
            
            this.emit('$disconnected');
            this.#recordConnection('disconnect');
            
            plugin.logger.info(`KOOK 机器人已断开: ${this.$config.name}`);
            
            return true;
        } catch (error) {
            plugin.logger.error(`断开连接时发生错误:`, {
                bot: this.$config.name,
                error: error.message
            });
            
            this.$connected = false;
            
            throw error;
        }
    }

    /**
     * 发送消息
     */
    async $sendMessage(options) {
        const startTime = Date.now();
        
        try {
            options = await plugin.app.handleBeforeSend(options);
            
            const result = await this.#sendWithRetry(options);
            const responseTime = Date.now() - startTime;
            
            this.#recordMessageSent(true, responseTime);
            
            return result;
        } catch (error) {
            return await this.#handleSendError(error, options, startTime);
        }
    }

    /**
     * 带重试的消息发送
     */
    async #sendWithRetry(options, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.#sendMessageInternal(options);
            } catch (error) {
                if (attempt >= maxRetries || !this.#shouldRetry(error)) {
                    throw error;
                }
                
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                plugin.logger.warn(`发送失败，${delay}ms后重试 (${attempt}/${maxRetries}):`, error.message);
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw new Error(`发送失败，已达到最大重试次数`);
    }

    /**
     * 内部发送消息方法
     */
    async #sendMessageInternal(options) {
        const sendableContent = KookBot.toSendable(options.content);
        
        switch (options.type) {
            case 'private': {
                const result = await this.sendPrivateMsg(options.id, sendableContent);
                plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id})`);
                return `private-${options.id}:${result.msg_id.toString()}`;
            }
                
            case "channel": {
                const result = await this.sendChannelMsg(options.id, sendableContent);
                plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id})`);
                return `channel-${options.id}:${result.msg_id.toString()}`;
            }
                
            default:
                throw new Error(`不支持的频道类型: ${options.type}`);
        }
    }

    /**
     * 处理发送错误
     */
    async #handleSendError(error, options, startTime) {
        const responseTime = Date.now() - startTime;
        
        this.#recordMessageSent(false, responseTime);
        
        const handledError = this.#classifyAndHandleError(error, options, responseTime);
        
        plugin.logger.error(`发送消息失败:`, {
            bot: this.$config.name,
            type: options.type,
            target: options.id,
            error: handledError.message
        });
        
        throw handledError;
    }

    /**
     * 错误分类和处理
     */
    #classifyAndHandleError(error, options, responseTime) {
        if (error.message?.includes('网络') || 
            error.message?.includes('连接') || 
            error.message?.includes('timeout')) {
            
            if (this.$connected) {
                this.$connected = false;
                this.emit('$disconnected');
            }
            
            return new Error(`网络错误: ${error.message}`);
        }
        
        if (error.message?.includes('权限') || 
            error.message?.includes('token') ||
            error.code === 401 || 
            error.code === 403) {
            
            return new Error(`权限不足: ${error.message}`);
        }
        
        if (error.message?.includes('频率') || error.code === 429) {
            return new Error(`发送频率过高: ${error.message}`);
        }
        
        if (error.message?.includes('消息') || error.code === 400) {
            return new Error(`消息内容错误: ${error.message}`);
        }
        
        if (error.code && error.code >= 500 && error.code < 600) {
            return new Error(`服务器错误: ${error.message}`);
        }
        
        return new Error(`发送失败: ${error.message}`);
    }

    /**
     * 判断错误是否应该重试
     */
    #shouldRetry(error) {
        if (error.message?.includes('网络') || 
            error.message?.includes('连接') || 
            error.message?.includes('超时') ||
            error.code === 408) {
            return true;
        }
        
        if (error.message?.includes('频率') || error.code === 429) {
            return true;
        }
        
        if (error.code && error.code >= 500 && error.code < 600) {
            return true;
        }
        
        if (error.message?.includes('权限') || 
            error.message?.includes('token') ||
            error.message?.includes('消息') ||
            error.code === 400 || 
            error.code === 401 || 
            error.code === 403) {
            return false;
        }
        
        return false;
    }

    /**
     * 包装连接错误
     */
    #wrapConnectionError(error) {
        let wrappedError;
        
        if (error.message?.includes('token') || error.code === 401) {
            wrappedError = new Error(`KOOK 令牌无效: ${error.message}`);
            wrappedError.code = 'INVALID_TOKEN';
        } else if (error.message?.includes('网络') || error.message?.includes('连接')) {
            wrappedError = new Error(`网络连接失败: ${error.message}`);
            wrappedError.code = 'NETWORK_ERROR';
        } else if (error.message?.includes('验证')) {
            wrappedError = new Error(`WebHook 验证失败: ${error.message}`);
            wrappedError.code = 'VERIFICATION_ERROR';
        } else {
            wrappedError = new Error(`连接失败: ${error.message}`);
            wrappedError.code = 'CONNECTION_ERROR';
        }
        
        wrappedError.originalError = error;
        return wrappedError;
    }

    /**
     * 撤回消息
     */
    async $recallMessage(id) {
        try {
            if (!/^(private|channel)-([^\:]+):(.+)$/.test(id)) {
                throw new Error(`无效的消息ID格式: ${id}`);
            }
            
            const [_, target_type, target_id, message_id] = id.match(/^(private|channel)-([^\:]+):(.+)$/);
            
            if (target_type === 'private') {
                await this.recallPrivateMsg(target_id, message_id);
            } else if (target_type === 'channel') {
                await this.recallChannelMsg(target_id, message_id);
            }
            
            this.#recordMessageRecalled();
            plugin.logger.info(`消息撤回成功: ${id}`);
            
            return true;
        } catch (error) {
            plugin.logger.error(`撤回消息时发生错误:`, {
                messageId: id,
                error: error.message
            });
            
            throw new Error(`撤回消息失败: ${error.message}`);
        }
    }

    /**
     * 处理接收到的 KOOK 消息
     */
    handleKookMessage(msg) {
        try {
            const message = this.$formatMessage(msg);
            
            this.#recordMessageReceived(message);
            
            plugin.dispatch('message.receive', message);
            
            plugin.logger.info(`${this.$config.name} recv ${message.$channel.type}(${message.$channel.id})`);
            plugin.dispatch(`message.${message.$channel.type}.receive`, message);
        } catch (error) {
            plugin.logger.error(`处理 KOOK 消息时发生错误:`, error);
            this.emit('$message_error', error, msg);
        }
    }

    /**
     * 处理客户端错误
     */
    handleClientError(error) {
        plugin.logger.error(`KOOK 客户端错误:`, error);
        this.#recordConnection('client_error');
        this.emit('$client_error', error);
    }

    /**
     * 记录连接事件
     */
    #recordConnection(type) {
        try {
            useContext('kook-stats', (stats) => {
                if (stats && typeof stats.recordConnection === 'function') {
                    stats.recordConnection(type);
                }
            });
        } catch (error) {
            // 静默处理
        }
    }

    /**
     * 记录消息接收
     */
    #recordMessageReceived(message) {
        try {
            useContext('kook-stats', (stats) => {
                if (stats && typeof stats.recordMessageReceived === 'function') {
                    stats.recordMessageReceived(message);
                }
            });
        } catch (error) {
            // 静默处理
        }
    }

    /**
     * 记录消息发送
     */
    #recordMessageSent(success, responseTime) {
        try {
            useContext('kook-stats', (stats) => {
                if (stats && typeof stats.recordMessageSent === 'function') {
                    stats.recordMessageSent(success);
                }
                
                if (stats && typeof stats.recordResponseTime === 'function' && success) {
                    stats.recordResponseTime(responseTime);
                }
            });
        } catch (error) {
            // 静默处理
        }
    }

    /**
     * 记录消息撤回
     */
    #recordMessageRecalled() {
        try {
            useContext('kook-stats', (stats) => {
                if (stats && typeof stats.recordMessageRecalled === 'function') {
                    stats.recordMessageRecalled();
                }
            });
        } catch (error) {
            // 静默处理
        }
    }

    /**
     * 检查连接状态
     */
    async $checkConnection() {
        try {
            await this.getSelfInfo();
            this.$connected = true;
            return true;
        } catch (error) {
            this.$connected = false;
            return false;
        }
    }

    /**
     * 获取机器人信息
     */
    async $getBotInfo() {
        try {
            const info = await this.getSelfInfo();
            return {
                id: info.id,
                name: info.username,
                nickname: info.nickname || info.username,
                avatar: info.avatar,
                connected: this.$connected
            };
        } catch (error) {
            plugin.logger.error(`获取机器人信息失败:`, error);
            return null;
        }
    }
}

/**
 * 静态工具方法 - 消息格式转换
 */
(function (KookBot) {
    function toSegments(message) {
        if (!Array.isArray(message)) message = [message];
        
        return message.map((item) => {
            if (typeof item === "string") {
                return { type: 'text', data: { text: item } };
            }

            const { type, ...rest } = item;

            if (item.data !== undefined) {
                return { 
                    type: type === 'markdown' ? 'text' : type, 
                    data: item.data 
                };
            }

            return { 
                type: type === 'markdown' ? 'text' : type, 
                data: rest 
            };
        });
    }
    KookBot.toSegments = toSegments;

    function toSendable(content) {
        if (!Array.isArray(content)) content = [content];

        return content.map((segment) => {
            if (typeof segment === "string") {
                return { type: 'text', text: segment };
            }

            if (segment.type === 'card') {
                if (segment.data) {
                    return { type: 'card', ...segment.data };
                }
                
                const cardObj = { type: 'card' };
                Object.keys(segment).forEach(key => {
                    if (!key.startsWith('$') && key !== 'type') {
                        cardObj[key] = segment[key];
                    }
                });
                return cardObj;
            }

            const { type, data } = segment;
            
            if (!data) {
                const result = { type };
                Object.keys(segment).forEach(key => {
                    if (!key.startsWith('$') && key !== 'type') {
                        result[key] = segment[key];
                    }
                });
                return result;
            }

            return { type, ...data };
        });
    }
    KookBot.toSendable = toSendable;
})(KookBot || (KookBot = {}));

/**
 * KOOK 统计服务
 */
register({
    name: 'kook-stats',
    description: 'KOOK 平台消息和连接统计服务',
    
    mounted() {
        const stats = {
            messages: {
                received: 0,
                sent: 0,
                failed: 0,
                recalled: 0
            },
            
            connection: {
                connects: 0,
                disconnects: 0,
                errors: 0,
                client_errors: 0,
                lastConnected: null
            },
            
            userActivity: new Map(),
            channelActivity: new Map(),
            
            performance: {
                totalResponseTime: 0,
                avgResponseTime: 0,
                maxResponseTime: 0,
                minResponseTime: Infinity,
                count: 0
            }
        };
        
        return {
            recordConnection: (type) => {
                switch (type) {
                    case 'connect':
                        stats.connection.connects++;
                        stats.connection.lastConnected = Date.now();
                        break;
                    case 'disconnect':
                    case 'disconnected':
                        stats.connection.disconnects++;
                        break;
                    case 'error':
                        stats.connection.errors++;
                        break;
                    case 'client_error':
                        stats.connection.client_errors++;
                        break;
                }
            },
            
            recordMessageReceived: (message) => {
                stats.messages.received++;
                
                const userId = message.$sender.id;
                const userStats = stats.userActivity.get(userId) || { 
                    messageCount: 0, 
                    lastActive: Date.now() 
                };
                userStats.messageCount++;
                userStats.lastActive = Date.now();
                stats.userActivity.set(userId, userStats);
                
                const channelId = message.$channel.id;
                const channelStats = stats.channelActivity.get(channelId) || {
                    messageCount: 0,
                    lastActivity: Date.now()
                };
                channelStats.messageCount++;
                channelStats.lastActivity = Date.now();
                stats.channelActivity.set(channelId, channelStats);
            },
            
            recordMessageSent: (success) => {
                if (success) {
                    stats.messages.sent++;
                } else {
                    stats.messages.failed++;
                }
            },
            
            recordMessageRecalled: () => {
                stats.messages.recalled++;
            },
            
            recordResponseTime: (time) => {
                stats.performance.count++;
                stats.performance.totalResponseTime += time;
                stats.performance.avgResponseTime = 
                    stats.performance.totalResponseTime / stats.performance.count;
                stats.performance.maxResponseTime = Math.max(stats.performance.maxResponseTime, time);
                stats.performance.minResponseTime = Math.min(stats.performance.minResponseTime, time);
            },
            
            getStats: () => ({
                messages: { ...stats.messages },
                connection: { ...stats.connection },
                activity: {
                    activeUsers: stats.userActivity.size,
                    activeChannels: stats.channelActivity.size
                },
                performance: { ...stats.performance }
            }),
            
            resetStats: () => {
                stats.messages = { received: 0, sent: 0, failed: 0, recalled: 0 };
                stats.connection = { connects: 0, disconnects: 0, errors: 0, client_errors: 0, lastConnected: null };
                stats.userActivity.clear();
                stats.channelActivity.clear();
                stats.performance = { totalResponseTime: 0, avgResponseTime: 0, maxResponseTime: 0, minResponseTime: Infinity, count: 0 };
            }
        };
    },
    
    dispose(service) {
        plugin.logger.info('KOOK 统计服务已清理');
    }
});

/**
 * KOOK API 服务
 */
register({
    name: 'kook-api',
    description: 'KOOK 平台原生 API 服务',
    
    async mounted(plugin) {
        const getKookBots = () => {
            return plugin.app.bots.filter(bot => bot.adapter === 'kook');
        };
        
        return {
            getBots: getKookBots,
            
            getBot: (name) => {
                return getKookBots().find(bot => bot.name === name);
            },
            
            sendRawMessage: async (options) => {
                const bot = options.botName 
                    ? this.getBot(options.botName) 
                    : getKookBots()[0];
                    
                if (!bot) {
                    throw new Error('未找到可用的 KOOK 机器人');
                }
                
                return await bot.$sendMessage({
                    ...options,
                    context: 'kook',
                    bot: bot.$config.name
                });
            },
            
            batchSend: async (messages) => {
                const results = [];
                
                for (const msg of messages) {
                    try {
                        const result = await this.sendRawMessage(msg);
                        results.push({ success: true, result });
                    } catch (error) {
                        results.push({ success: false, error: error.message });
                    }
                }
                
                return results;
            },
            
            checkAllConnections: async () => {
                const bots = getKookBots();
                const results = [];
                
                for (const bot of bots) {
                    try {
                        const connected = await bot.$checkConnection();
                        results.push({
                            name: bot.$config.name,
                            connected,
                            status: connected ? '在线' : '离线'
                        });
                    } catch (error) {
                        results.push({
                            name: bot.$config.name,
                            connected: false,
                            status: '检查失败',
                            error: error.message
                        });
                    }
                }
                
                return results;
            }
        };
    },
    
    async dispose(service) {
        plugin.logger.info('KOOK API 服务已清理');
    }
});

/**
 * 注册适配器到 Zhin.js 框架
 */
registerAdapter(new Adapter('kook', KookBot));

plugin.logger.info('KOOK 适配器已加载');
