import {
    Bot,
    PrivateMessageEvent,
    GroupMessageEvent,
    ReceiverMode, ApplicationPlatform
} from "qq-official-bot";
import path from "path";
export {
    ReceiverMode,
} from 'qq-official-bot'
export type {
    ApplicationPlatform,
    Intent,
} from 'qq-official-bot'
import {
    Bot as ZhinBot,
    BotConfig,
    Adapter,
    Plugin,
    registerAdapter,
    Message,
    SendOptions,
    SendContent,
    segment
} from "zhin.js";
declare module 'zhin.js'{
    interface RegisteredAdapters{
        qq:Adapter<QQBot<ReceiverMode>>
    }
}
export type QQBotConfig<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> = BotConfig &Bot.Config<T,M> &{
    context:'qq'
    name:`${number}`
}
export interface QQBot<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform>{
    $config:QQBotConfig<T,M>
}
export class QQBot<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> extends Bot implements ZhinBot<PrivateMessageEvent|GroupMessageEvent,QQBotConfig<T,M>>{
    $connected?:boolean
    constructor(private plugin:Plugin,config:QQBotConfig<T,M>) {
        if(!config.data_dir) config.data_dir=path.join(process.cwd(),'data')
        super(config);
        this.$config=config
    }
    private handleQQMessage(msg: PrivateMessageEvent|GroupMessageEvent): void {
        const message =this.$formatMessage(msg) ;
        this.plugin.dispatch('message.receive',message)
        this.plugin.logger.info(`recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`)
        this.plugin.dispatch(`message.${message.$channel.type}.receive`,message)
    }
    async $connect(): Promise<void> {
        this.on('message.group',this.handleQQMessage.bind(this))
        this.on('message.guild',this.handleQQMessage.bind(this))
        this.on('message.private',this.handleQQMessage.bind(this))
        await this.start()
        this.$connected=true;
    }

    async $disconnect(): Promise<void> {
        await this.stop()
        this.$connected=false;
    }
    $formatMessage(msg:PrivateMessageEvent|GroupMessageEvent){
        let target_id=msg.user_id;
        if(msg.message_type==='guild') target_id=msg.channel_id!
        if(msg.message_type==='group') target_id=msg.group_id!;
        if(msg.sub_type==='direct') target_id=`direct:${msg.guild_id}`;
        const result= Message.from(msg,{
            $id: msg.message_id?.toString(),
            $adapter:'qq',
            $bot:this.$config.name,
            $sender:{
                id:msg.sender.user_id?.toString(),
                name:msg.sender.user_name?.toString(),
            },
            $channel:{
                id:target_id,
                type:msg.message_type==='guild'?"channel":msg.message_type,
            },
            $content: msg.message,
            $raw: msg.raw_message,
            $timestamp: Date.now(),
            $reply:async (content: SendContent, quote: boolean|string=true):Promise<void>=> {
                if(!Array.isArray(content)) content=[content];
                if(quote) content.unshift({type:'reply',data:{id:typeof quote==="boolean"?result.$id:quote}})
                this.plugin.dispatch('message.send',{
                    ...result.$channel,
                    context:'qq',
                    bot:this.$config.name,
                    content
                })
            }
        })
        return result
    }

    async $sendMessage(options: SendOptions): Promise<void> {
        options=await this.plugin.app.handleBeforeSend(options)
        switch (options.type){
            case 'private':{
                if(options.id.startsWith('direct:')){
                    const id=options.id.replace('direct:','')
                    await this.sendDirectMessage(id,options.content)
                    this.plugin.logger.info(`send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                }else{
                    await this.sendPrivateMessage(options.id,options.content)
                    this.plugin.logger.info(`send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                }
                break;
            }
            case "group":{
                await this.sendGroupMessage(options.id,options.content)
                this.plugin.logger.info(`send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                break;
            }
            case 'channel':{
                await this.sendGuildMessage(options.id,options.content)
                this.plugin.logger.info(`send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                break;
            }
            default:
                throw new Error(`unsupported channel type ${options.type}`)
        }
    }

}

registerAdapter(new Adapter('qq',QQBot))
