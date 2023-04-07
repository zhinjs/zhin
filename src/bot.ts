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

export class Bot<K extends keyof Zhin.Adapters=keyof Zhin.Adapters,BO={},AO={},I=object> extends EventEmitter{
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
    isMaster<P extends keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]=keyof Zhin.BotEventMaps[P]>(session:NSession<P,E>){
        return this.options.master===session.user_id
    }
    // 会话发起者是否为zhin管理员
    isAdmin<P extends keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]=keyof Zhin.BotEventMaps[P]>(session:NSession<P,E>){
        return this.options.admins && this.options.admins.includes(session.user_id)
    }
    reply(session:NSession<K>,message:Element.Fragment,quote?:boolean){
        if(session.type!=='message') throw new Error(`not exist reply when type !=='message'`)
        message=[].concat(message)
        const replyElem:Element|undefined=quote?Element('reply',{message_id:session.message_id}):undefined
        if(replyElem) message.unshift(replyElem)
        return this.sendMsg(session.group_id||session.discuss_id||session.user_id||`${session.guild_id}:${session.channel_id}`,session.detail_type as Bot.MessageType,message)
    }
    callApi<T extends keyof I>(apiName:T,...args:Params<I[T]>){
        const fn=this.internal[apiName]
        return typeof fn==='function'?fn.apply(this.internal,args):fn
    }
}
type Params<T>=T extends (...args:infer R)=>any ? R:never
type Return<T>=T extends ((...args:any[])=>infer R)?R:T
export interface Bot<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={},I=object>{
    self_id:string|number
    options:BotOptions<BO>
    adapter:Adapter<K,BO,AO>
    zhin:Zhin
    sendMsg(target_id:string|number,target_type:Bot.MessageType,message:Element.Fragment):Promise<Bot.MessageRet>
    getMsg(message_id:string):Promise<Bot.Message>
    deleteMsg(message_id:string):Promise<boolean>
    createSession(event: string, ...args: any[]): NSession<K>
    callApi<K extends keyof I>(apiName:K,...args:Params<I[K]>):Promise<Return<I[K]>>
    // 会话发起者是否为群管理员
    isGroupAdmin?<P extends keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]=keyof Zhin.BotEventMaps[P]>(session:NSession<P,E>):boolean
    // 会话发起者是否为频道管理员
    isChannelAdmin?<P extends keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]=keyof Zhin.BotEventMaps[P]>(session:NSession<P,E>):boolean
    // 会话发起者是否为群主
    isGroupOwner?<P extends keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]=keyof Zhin.BotEventMaps[P]>(session:NSession<P,E>):boolean
    start():any
}
export type BotConstructs={
    [P in keyof Zhin.Adapters]?:BotConstruct<P>
}
export namespace Bot{
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
    export const botConstructors:BotConstructs={}
    export function define<K extends keyof Zhin.Adapters>(key: K, botConstruct: BotConstruct<K>) {
        // @ts-ignore
        botConstructors[key]=botConstruct
    }
}
export class BotList<K extends keyof Zhin.Adapters> extends Array<Zhin.Bots[K]>{
    get(self_id:string|number){
        return this.find(bot=>bot.self_id===self_id || bot.self_id===Number(self_id)) as Zhin.Bots[K]
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
    export interface Message{
        from_id:string|number
        to_id:string|number
        user_id:string|number
        type:MessageType
        elements:Element[]
    }
}