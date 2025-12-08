import {EventEmitter} from "events";
import {
    Bot,
    Adapter,
    usePlugin,
    Message,
    SendOptions,
    segment,
    SendContent,
    MessageType,
    MessageElement,
} from "zhin.js";
import type {WebSocket} from "ws";
export interface ProcessConfig{
    name: string;
}

export interface SandboxConfig {
    context: 'sandbox';
    ws:WebSocket;
    name: string;
}
const plugin=usePlugin()
const logger = plugin.logger;
export class ProcessBot extends EventEmitter implements Bot<ProcessConfig,{content:string,ts:number}>{
    $connected?:boolean
    private logger = logger
    get $id(){
        return `${process.pid}`
    }
    constructor(public $config:ProcessConfig) {
        super();
        this.#listenInput=this.#listenInput.bind(this)
    }

    async $connect(): Promise<void> {
        console.log('connect')
        if(this.$connected) return;
        process.stdin.on('data',this.#listenInput);
        this.$connected=true
    }

    async $disconnect(){
        process.stdin.off('data',this.#listenInput)
        this.$connected=false
    }

    $formatMessage({content,ts}:{content:string,ts:number}) {
        const message=Message.from({content,ts},{
            $id: `${ts}`,
            $adapter:'process',
            $bot:`${this.$config.name}`,
            $sender:{
                id:`${process.pid}`,
                name:process.title,
            },
            $channel:{
                id:`${process.pid}`,
                type:'private'
            },
            $content:[{type:'text',data:{text:content}}],
            $raw:content,
            $timestamp: ts,
            $recall: async () => {
                await this.$recallMessage(message.$id)
            },
            $reply:async (content: SendContent, quote?: boolean|string):Promise<string>=> {
                if(!Array.isArray(content)) content=[content];
                if(quote) content.unshift({type:'reply',data:{id:typeof quote==="boolean"?message.$id:quote}})
                return await this.$sendMessage({
                    ...message.$channel,
                    context:'process',
                    bot:`${process.pid}`,
                    content
                })
            }
        })
        return message
    }

    async $sendMessage(options: SendOptions): Promise<string>{
        // options=await plugin.handleBeforeSend(options)
        if(!this.$connected) return ''
        this.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
        return ''
    }
    async $recallMessage(id: string): Promise<void> {
        // 进程不支持撤回消息
    }
    #listenInput:(data:Buffer<ArrayBufferLike>)=>void=function (this:ProcessBot,data){
        const content=data.toString().trim()
        const ts=Date.now()
        const message =this.$formatMessage({content,ts});
        this.logger.info(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`)
        plugin.emit('message.receive',message)
        plugin.emit(`message.${message.$channel.type}.receive`,message)
    }

    // 新增：Web 沙盒消息接收接口
    public receiveWebMessage(channelType: 'private' | 'group' | 'channel', channelId: string, content: string, senderId: string = 'web_user', senderName: string = 'Web用户'): void {
        const ts = Date.now()
        const message = Message.from({ content, ts }, {
            $id: `web_${ts}`,
            $adapter: 'process',
            $bot: `${this.$config.name}`,
            $sender: {
                id: senderId,
                name: senderName,
            },
            $channel: {
                id: channelId,
                type: channelType
            },
            $content: [{ type: 'text', data: { text: content } }],
            $raw: content,
            $timestamp: ts,
            $recall: async () => {
                await this.$recallMessage(message.$id)
            },
            $reply: async (replyContent: SendContent, quote?: boolean | string): Promise<string> => {
                if (!Array.isArray(replyContent)) replyContent = [replyContent];
                if (quote) replyContent.unshift({ type: 'reply', data: { id: typeof quote === "boolean" ? message.$id : quote } })
                return await this.$sendMessage({
                    ...message.$channel,
                    context: 'process',
                    bot: this.$config.name,
                    content: replyContent
                })
            }
        })
        
        this.logger.info(`[Web] recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`)
        plugin.emit('message.receive', message)
        plugin.emit(`message.${message.$channel.type}.receive`, message)
    }
}
export class SandboxBot extends EventEmitter implements Bot<SandboxConfig,{content:MessageElement[],ts:number}>{
    $connected?:boolean
    get $id(){
        return this.$config.name
    }
    private logger = logger
    constructor(public $config:SandboxConfig) {
        super();
        this.$config.ws.on('message',(data)=>{
            const message = JSON.parse(data.toString())
            this.logger.info(`${this.$config.name} recv  ${message.type}(${message.id}):${segment.raw(message.content)}`)
            plugin.emit('message.receive',this.$formatMessage({content:message.content,type:message.type,id:message.id,ts:message.timestamp}))
            plugin.emit(`message.${message.type as MessageType}.receive`,this.$formatMessage({content:message.content,type:message.type,id:message.id,ts:message.timestamp}))
        })
    }
    async $connect(): Promise<void> {
        this.$connected=true
    }
    async $disconnect(): Promise<void> {
        this.$connected=false
    }
    $formatMessage({content,type,id,ts}:{content:MessageElement[],id:string,type:MessageType,ts:number}) {
        const message =  Message.from({content,ts},{
            $id: `${ts}`,
            $adapter:'sandbox',
            $bot:`${this.$config.name}`,
            $sender:{
                id:`${this.$config.name}`,
                name:this.$config.name,
            },
            $channel:{
                id:`${id}`,
                type:type
            },
            $content:content,
            $raw:segment.raw(content),
            $timestamp: ts,
            $recall: async () => {
                await this.$recallMessage(message.$id)
            },
            $reply:async (content: SendContent, quote?: boolean|string):Promise<string>=> {
                if(!Array.isArray(content)) content=[content];
                if(quote) content.unshift({type:'reply',data:{id:typeof quote==="boolean"?message.$id:quote}})
                return await this.$sendMessage({
                    ...message.$channel,
                    context:'sandbox',
                    bot:`${this.$config.name}`,
                    content
                })
            }
        })
        return message
    }
    async $sendMessage(options: SendOptions): Promise<string>{
        // options=await plugin.app.handleBeforeSend(options)
        if(!this.$connected) return ''
        this.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
        options.bot=this.$config.name
        options.context='sandbox'
        this.$config.ws.send(JSON.stringify({
            ...options,
            content:options.content, // 发送消息段数组
            timestamp:Date.now()
        }))
        return ''
    }
    async $recallMessage(id: string): Promise<void> {
        // 沙盒不支持撤回消息
    }
}
class ProcessAdapter extends Adapter<ProcessBot>{
    constructor(plugin: any, config:ProcessConfig[]){
        super(plugin, 'process', config)
    }
    createBot(config: ProcessConfig): ProcessBot {
        return new ProcessBot(config);
    }
}