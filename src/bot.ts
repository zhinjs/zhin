import {Zhin} from "./zhin";
import {Adapter} from "./adapter";
import {Plugin} from "./plugin";
import {NSession} from "./session";
import {deepMerge, remove} from '@zhinjs/shared'
import {EventEmitter} from "events";
import {Element} from "./element";
import {ref, watch} from "obj-observer";
export type BotOptions<O={}>={
    quote_self?:boolean
    self_id?:string|number
    prefix?:string
    enable?:boolean
    master?:string|number
    disable_plugins?:string[]
    admins?:(string|number)[]
} & O

export class Bot<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={},I extends object=object> extends EventEmitter{
    public internal:I
    public options:BotOptions<BO>
    constructor(public zhin:Zhin,public adapter:Adapter<K,BO,AO>,options:BotOptions<BO>) {
        super();
        this.options=ref(deepMerge(Bot.defaultOptions,options))
        this.on('message',(message:Bot.MessageRet)=>{
            this.adapter.emit('message.receive',this.self_id,message)
        })
        watch(this.options,(value:BotOptions<BO>)=>{
            this.adapter.changeOptions(this.self_id,value)
        })
    }
    get status(){
        return this.adapter.botStatus(this.self_id)
    }
    isOnline(){
        return this.status.online===true
    }
    enable():boolean
    enable(plugin:Plugin):this
    enable(plugin?:Plugin):this|boolean{
        if(!plugin) return this.options.enable=true
        if(!this.options.disable_plugins.includes(plugin.options.fullName)){
            this.zhin.logger.warn(`Bot(${this.self_id})插件未被禁用:${plugin.name}`)
            return this
        }
        remove(this.options.disable_plugins,plugin.options.fullName)
        return this
    }
    disable():boolean
    disable(plugin:Plugin):this
    disable(plugin?:Plugin):this|boolean{
        if(!plugin) return this.options.enable=false
        if(!this.options.disable_plugins.includes(plugin.options.fullName)){
            this.zhin.logger.warn(`Bot(${this.self_id})重复禁用插件:${plugin.name}`)
            return this
        }
        this.options.disable_plugins.push(plugin.options.fullName)
        return this
    }
    // 机器人是否启用指定插件
    match(plugin:Plugin){
        return !this.options.disable_plugins.includes(plugin.options.fullName)
    }
    // 会话发起者是否为zhin主人
    isMaster(session:NSession<K>){
        return this.options.master===session.user_id
    }
    // 会话发起者是否为zhin管理员
    isAdmin(session:NSession<K>){
        return this.options.admins && this.options.admins.includes(session.user_id)
    }
    reply(session:NSession<K>,message:Element.Fragment,quote?:boolean){
        if(session.type!=='message') throw new Error(`not exist reply when type !=='message'`)
        message=[].concat(message)
        const replyElem:Element|undefined=quote?Element('reply',{message_id:session.message_id}):undefined
        if(replyElem) message.unshift(replyElem)
        return this.sendMsg(session.group_id||session.discuss_id||session.user_id||`${session.guild_id}:${session.channel_id}`,session.detail_type as Bot.MessageType,message)
    }
    async sendMsg(target_id:string|number,target_type:Bot.MessageType,message:Element.Fragment):Promise<Bot.MessageRet>{
        message=Element.toElementArray(message)
        const {message_id}=await this.callApi('sendMsg',target_id,target_type,message)
        const messageRet:Bot.MessageRet={
            message_id,
            from_id:this.self_id,
            user_id:this.self_id,
            to_id:target_id,
            type:target_type,
            elements:message as Element[]
        }
        this.adapter.emit(`message.send`,this.self_id,messageRet)
        return messageRet
    }
}
export interface Bot<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={},I extends object=object>{
    self_id:string|number
    options:BotOptions<BO>
    adapter:Adapter<K,BO,AO>
    zhin:Zhin
    createSession(event: string, ...args: any[]): NSession<K>
    callApi<K extends keyof Bot.Methods>(apiName:K,...args:Parameters<Bot.Methods[K]>):Promise<ReturnType<Bot.Methods[K]>>
    // 会话发起者是否为群管理员
    isGroupAdmin?(session:NSession<K>):boolean
    // 会话发起者是否为频道管理员
    isChannelAdmin?(session:NSession<K>):boolean
    // 会话发起者是否为群主
    isGroupOwner?(session:NSession<K>):boolean
    start():any
}
export type BotConstructors={
    [P in (keyof Zhin.Adapters)]?:BotConstruct<P>
}
export namespace Bot{
    export interface Methods{
        sendMsg(target_id:string|number,target_type:MessageType,message:Element.Fragment):MessageRet
        getMsg(message_id:string):Message
        deleteMsg(message_id:string):boolean
    }
    export type MessageType='private'|'group'|'discuss'|'guild'
    export interface MessageRet extends Message{
        message_id:string
    }
    export type FullTargetId=`${keyof Zhin.Adapters}:${string|number}:${string}:${string|number|`${string|number}:${string|number}`}`
    export function getFullTargetId(session:NSession<keyof Zhin.Adapters>):FullTargetId{
        return [
            session.adapter.protocol,
            session.bot.self_id,
            session.detail_type,
            session.guild_id,
            session.channel_id,
            session.group_id,
            session.discuss_id,
            session.user_id
        ].filter(Boolean).join(':') as FullTargetId
    }
    export const botConstructors:BotConstructors={}
    export function define<K extends keyof Zhin.Adapters>(key: K, botConstruct: BotConstruct<K>) {
        botConstructors[key]=botConstruct
    }
}
export class BotList extends Array<Zhin.Bot>{
    get(self_id:string|number){
        return this.find(bot=>bot.self_id===self_id || bot.self_id===Number(self_id)) as Zhin.Bot
    }
}
export type BotConstruct<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={}>={
    new(zhin:Zhin, protocol:Zhin.Adapters[K], options:BotOptions<BO>):Zhin.Bots[K]
}
export namespace Bot{
    export const defaultOptions:BotOptions={
        quote_self:false,
        enable:true,
        disable_plugins:[],
        admins:[]
    }
    interface MsgBase{
        user_id:string|number
        elements:Element[]
    }
    export interface Message{
        from_id:string|number
        to_id:string|number
        user_id:string|number
        type:MessageType
        elements:Element[]
    }
}