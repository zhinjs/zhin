import {EventEmitter} from "events";
import {
    Bot,
    Adapter,
    Plugin,
    BotConfig,
    registerAdapter,
    useLogger,
    Message,
    SendOptions,
    segment,
    SendContent,
    usePlugin,
    useContext,
    MessageType,
    MessageElement,
} from "zhin.js";
import path from "path";
import type {WebSocket} from "ws";
import crypto from "crypto";

declare module '@zhin.js/types'{
    interface RegisteredAdapters{
        process:Adapter<ProcessBot>
        sandbox:Adapter<SandboxBot>
    }
}
export interface ProcessConfig extends BotConfig {
    context: 'process';
    name: string;
}

export interface SandboxConfig extends BotConfig {
    context: 'sandbox';
    ws:WebSocket;
    name: string;
}
const plugin=usePlugin()
const logger = useLogger()
export class ProcessBot extends EventEmitter implements Bot<{content:string,ts:number},ProcessConfig>{
    $connected?:boolean
    private logger = logger

    constructor(private plugin:Plugin,public $config:ProcessConfig) {
        super();
        this.#listenInput=this.#listenInput.bind(this)
    }

    async $connect(): Promise<void> {
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
            $reply:async (content: SendContent, quote?: boolean|string):Promise<void>=> {
                if(!Array.isArray(content)) content=[content];
                if(quote) content.unshift({type:'reply',data:{id:typeof quote==="boolean"?message.$id:quote}})
                this.plugin.dispatch('message.send',{
                    ...message.$channel,
                    context:'process',
                    bot:`${process.pid}`,
                    content
                })
            }
        })
        return message
    }

    async $sendMessage(options: SendOptions){
        options=await this.plugin.app.handleBeforeSend(options)
        if(!this.$connected) return
        this.logger.info(`send ${options.type}(${options.id}):${segment.raw(options.content)}`)
    }

    #listenInput:(data:Buffer<ArrayBufferLike>)=>void=function (this:ProcessBot,data){
        const content=data.toString().trim()
        const ts=Date.now()
        const message =this.$formatMessage({content,ts});
        this.logger.info(`recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`)
        this.plugin.dispatch('message.receive',message)
        this.plugin.dispatch(`message.${message.$channel.type}.receive`,message)
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
            $reply: async (replyContent: SendContent, quote?: boolean | string): Promise<void> => {
                if (!Array.isArray(replyContent)) replyContent = [replyContent];
                if (quote) replyContent.unshift({ type: 'reply', data: { id: typeof quote === "boolean" ? message.$id : quote } })
                this.plugin.dispatch('message.send', {
                    ...message.$channel,
                    context: 'process',
                    bot: this.$config.name,
                    content: replyContent
                })
            }
        })
        
        this.logger.info(`[Web] recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`)
        this.plugin.dispatch('message.receive', message)
        this.plugin.dispatch(`message.${message.$channel.type}.receive`, message)
    }
}
export class SandboxBot extends EventEmitter implements Bot<{content:MessageElement[],ts:number},SandboxConfig>{
    $connected?:boolean
    private logger = logger
    constructor(private plugin:Plugin,public $config:SandboxConfig) {
        super();
        this.$config.ws.on('message',(data)=>{
            const message = JSON.parse(data.toString())
            this.logger.info(`recv ${message.type}(${message.id}):${segment.raw(message.content)}`)
            this.plugin.dispatch('message.receive',this.$formatMessage({content:message.content,type:message.type,id:message.id,ts:message.timestamp}))
            this.plugin.dispatch(`message.${message.type}.receive`,this.$formatMessage({content:message.content,type:message.type,id:message.id,ts:message.timestamp}))
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
            $reply:async (content: SendContent, quote?: boolean|string):Promise<void>=> {
                if(!Array.isArray(content)) content=[content];
                if(quote) content.unshift({type:'reply',data:{id:typeof quote==="boolean"?message.$id:quote}})
                this.plugin.dispatch('message.send',{
                    ...message.$channel,
                    context:'sandbox',
                    bot:`${this.$config.name}`,
                    content
                })
            }
        })
        return message
    }
    async $sendMessage(options: SendOptions){
        options=await this.plugin.app.handleBeforeSend(options)
        if(!this.$connected) return
        this.logger.info(`send ${options.type}(${options.id}):${segment.raw(options.content)}`)
        options.bot=this.$config.name
        options.context='sandbox'
        this.$config.ws.send(JSON.stringify({
            ...options,
            content:options.content, // 发送消息段数组
            timestamp:Date.now()
        }))
    }
}
registerAdapter(new Adapter('process',ProcessBot))
const sandboxAdapter=new Adapter('sandbox',SandboxBot)
registerAdapter(sandboxAdapter)

useContext('web', (web) => {
    // 注册Process适配器的客户端入口文件
    const clientEntryPath = path.resolve(import.meta.dirname, '../client/index.tsx')
    const dispose = web.addEntry(clientEntryPath)
    return dispose
})

useContext('router', (router) => {
    const wss = router.ws('/sandbox')
    wss.on('connection', (ws) => {
        const targetBot = new SandboxBot(plugin,{
            context:'sandbox',
            name:`测试机器人${Math.random().toString(36).substring(2, 8)}`,
            ws
        })
        targetBot.$connect()
        sandboxAdapter.bots.set(targetBot.$config.name,targetBot)
        ws.on('close', () => {
            targetBot.$disconnect()
            sandboxAdapter.bots.delete(targetBot.$config.name)
        })
    })
    return () => {
        wss.close()
    }
})