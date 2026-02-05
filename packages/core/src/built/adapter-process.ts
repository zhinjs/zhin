import { Adapter, Plugin, Bot, SendContent, SendOptions, MessageBase, Message, segment } from "@zhin.js/core";
export class ProcessBot implements Bot<{},{content:string,ts:number}>{
    $id=`${process.pid}`;
    get logger() {
        return this.adapter.logger;
    }
    $connected=false;
    constructor(public adapter: ProcessAdapter, public $config={}) {
        this.$listenInput=this.$listenInput.bind(this);
    }
    $listenInput:(data:Buffer<ArrayBufferLike>)=>void=function (this:ProcessBot,data){
        const content = data.toString().trim();
        if (content) {
            this.adapter.emit('message.receive', this.$formatMessage({content,ts:Date.now()}));
        }
    }
    async connect() {
    }
    async disconnect() {
    }
    $formatMessage(event: {content:string,ts:number}): Message<{content:string,ts:number}> {
        const base:MessageBase={
            $id: `${event.ts}`,
            $adapter: 'process',
            $bot: `${process.pid}`,
            $sender: {
                id: `${process.pid}`,
                name: process.title,
            },
            $channel: {
                id: `${process.pid}`,
                type: 'private',
            },
            $content: [{type:'text',data:{text:event.content}}],
            $raw: event.content,
            $timestamp: event.ts,
            $recall: async () => {
                await this.$recallMessage(base.$id)
            },
            $reply: async (content: SendContent) => {
                return await this.adapter.sendMessage({
                    context: 'process',
                    bot: base.$bot,
                    content,
                    id: base.$id,
                    type: base.$channel.type,
                });
            },
        }
        return Message.from(event, base);
    }
    async $recallMessage(id: string) {
    }
    async $sendMessage(options: SendOptions) {
        return `${Date.now()}`;
    }
    async $connect(): Promise<void> {
        process.stdin.on('data', this.$listenInput);
        this.$connected = true;
    }
    async $disconnect() {
        process.stdin.removeListener('data', this.$listenInput);
    }
}
export class ProcessAdapter extends Adapter<ProcessBot>{
    constructor(plugin: Plugin) {
        super(plugin, 'process', [{}]);
        
        // 注册适配器提供的 AI 工具
        this.registerDefaultTools();
        this.registerProcessTools();
    }
    
    createBot(config: Adapter.BotConfig<ProcessBot>): ProcessBot {
        return new ProcessBot(this, config);
    }
    
    /**
     * 注册 Process 适配器特有的工具
     */
    private registerProcessTools(): void {
        // 获取进程信息
        this.addTool({
            name: 'process_get_info',
            description: '获取当前进程的详细信息，包括 PID、内存使用、运行时间等',
            parameters: {
                type: 'object',
                properties: {},
            },
            execute: async () => {
                const memUsage = process.memoryUsage();
                return {
                    pid: process.pid,
                    title: process.title,
                    uptime: process.uptime(),
                    platform: process.platform,
                    arch: process.arch,
                    nodeVersion: process.version,
                    memory: {
                        rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
                        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
                        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
                    },
                    cwd: process.cwd(),
                };
            },
        });
        
        // 获取环境变量
        this.addTool({
            name: 'process_get_env',
            description: '获取指定的环境变量值',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: '环境变量名称',
                    },
                },
                required: ['name'],
            },
            execute: async (args) => {
                const { name } = args;
                // 安全起见，不返回敏感环境变量
                const sensitive = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'CREDENTIAL'];
                if (sensitive.some(s => name.toUpperCase().includes(s))) {
                    return { error: '无法访问敏感环境变量' };
                }
                return { name, value: process.env[name] || null };
            },
        });
        
        // 输出到控制台
        this.addTool({
            name: 'process_console_log',
            description: '向控制台输出信息',
            parameters: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        description: '要输出的消息',
                    },
                    level: {
                        type: 'string',
                        description: '日志级别',
                    },
                },
                required: ['message'],
            },
            execute: async (args) => {
                const { message, level = 'info' } = args;
                switch (level) {
                    case 'warn':
                        console.warn(message);
                        break;
                    case 'error':
                        console.error(message);
                        break;
                    case 'debug':
                        console.debug(message);
                        break;
                    default:
                        console.log(message);
                }
                return { success: true, message: `已输出: ${message}` };
            },
        });
    }
}
declare module '../adapter.js'{
    interface Adapters{
        process:ProcessAdapter
    }
}