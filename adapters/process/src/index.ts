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
    MessageSegment,
    segment,
    SendContent
} from "@zhin.js/core";

declare module '@zhin.js/types'{
    interface RegisteredAdapters{
        process:Adapter<ProcessBot>
    }
}
export interface ProcessConfig extends BotConfig {
    context: 'process';
}

export class ProcessBot extends EventEmitter implements Bot<{content:string,ts:number},ProcessConfig>{
    $connected?:boolean
    private logger = useLogger()

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
}

registerAdapter(new Adapter('process',ProcessBot))