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
    usePlugin,
    Adapter,
    Plugin,
    registerAdapter,
    Message,
    SendOptions,
    SendContent,
    segment
} from "zhin.js";
// 声明模块，注册 qq 适配器类型
declare module '@zhin.js/types'{
    interface RegisteredAdapters{
        qq:Adapter<QQBot<ReceiverMode>>
    }
}
export type QQBotConfig<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> = ZhinBot.Config &Bot.Config<T,M> &{
    context:'qq'
    name:`${number}`
}
export interface QQBot<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform>{
    $config:QQBotConfig<T,M>
}
const plugin=usePlugin()
export class QQBot<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> extends Bot implements ZhinBot<PrivateMessageEvent|GroupMessageEvent,QQBotConfig<T,M>>{
    $connected?:boolean
    constructor(config:QQBotConfig<T,M>) {
        if(!config.data_dir) config.data_dir=path.join(process.cwd(),'data')
        super(config);
        this.$config=config
    }
    private handleQQMessage(msg: PrivateMessageEvent|GroupMessageEvent): void {
        const message =this.$formatMessage(msg) ;
        plugin.dispatch('message.receive',message)
        plugin.logger.info(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`)
        plugin.dispatch(`message.${message.$channel.type}.receive`,message)
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
            $recall: async () => {
                await this.$recallMessage(result.$id)
            },
            $reply:async (content: SendContent, quote: boolean|string=true):Promise<string>=> {
                if(!Array.isArray(content)) content=[content];
                if(quote) content.unshift({type:'reply',data:{id:typeof quote==="boolean"?result.$id:quote}})
                return await this.$sendMessage({
                    ...result.$channel,
                    context:'qq',
                    bot:this.$config.name,
                    content
                })
            }
        })
        return result
    }

    async $sendMessage(options: SendOptions): Promise<string> {
        options=await plugin.app.handleBeforeSend(options)
        switch (options.type){
            case 'private':{
                if(options.id.startsWith('direct:')){
                    const id=options.id.replace('direct:','')
                    const result= await this.sendDirectMessage(id,options.content)
                    plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                    plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                    return `direct-${options.id}:${result.message_id.toString()}`
                }else{
                    const result= await this.sendPrivateMessage(options.id,options.content)
                    plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                    plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                    return `private-${options.id}:${result.message_id.toString()}`
                }
                break;
            }
            case "group":{
                const result= await this.sendGroupMessage(options.id,options.content)
                plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                return `group-${options.id}:${result.message_id.toString()}`
                break;
            }
            case 'channel':{
                const result= await this.sendGuildMessage(options.id,options.content)
                plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                plugin.logger.info(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
                return `channel-${options.id}:${result.message_id.toString()}`
                break;
            }
            default:
                throw new Error(`unsupported channel type ${options.type}`)
        }
    }
    async $recallMessage(id:string):Promise<void> {
        if(!/^(private|group|channel|direct)-([^\:]+):(.+)$/.test(id)) throw new Error(`invalid message id ${id}`)
        const [target_type,target_id,message_id]=id.match(/^(private|group|channel|direct)-([^\:]+):(.+)$/)!
        if(target_type==='private') await this.recallPrivateMessage(target_id,message_id)
        if(target_type==='group') await this.recallGroupMessage(target_id,message_id)
        if(target_type==='channel') await this.recallGuildMessage(target_id,message_id)
        if(target_type==='direct') await this.recallDirectMessage(target_id,message_id)
    }

}

registerAdapter(new Adapter('qq',QQBot))
