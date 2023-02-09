import {Zhin} from "./zhin";
import {Adapter} from "./adapter";
import {Plugin} from "@/plugin";
import {Session} from "./session";
import {deepMerge, Promisify, remove} from './utils'
import {EventEmitter} from "events";
import {IcqqEventMap} from "@/adapters/icqq";
import Element from "@/element";
import {ref, watch} from "obj-observer";
export type BotOptions<O={}>={
    quote_self?:boolean
    self_id?:string|number
    prefix?:string
    enable?:boolean
    master?:string|number
    enable_plugins?:string[]
    disable_plugins?:string[]
    admins?:(string|number)[]
} & O

export class Bot<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={},I extends object=object> extends EventEmitter{
    public internal:I
    public options:BotOptions<BO>
    constructor(public app:Zhin,public adapter:Adapter<K,BO,AO>,options:BotOptions<BO>) {
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
        return this.status.online=true
    }
    enable():boolean
    enable(plugin:Plugin):this
    enable(plugin?:Plugin):this|boolean{
        if(plugin) {
            this.options.enable_plugins.push(plugin.options.fullName)
            remove(this.options.disable_plugins,plugin.options.fullName)
            return this
        }
        return this.options.enable=true
    }
    disable():boolean
    disable(plugin:Plugin):this
    disable(plugin?:Plugin):this|boolean{
        if(plugin) {
            this.options.disable_plugins.push(plugin.options.fullName)
            remove(this.options.enable_plugins,plugin.options.fullName)
            return this
        }
        return this.options.enable=false
    }
    match(plugin:Plugin){
        return this.options.enable_plugins.includes(plugin.options.fullName) || !this.options.disable_plugins.includes(plugin.options.fullName)
    }
    // 会话发起者是否为zhin主人
    isMaster(session:Session<K>){
        return this.options.master===session.user_id
    }
    // 会话发起者是否为zhin管理员
    isAdmin(session:Session<K>){
        return this.options.admins && this.options.admins.includes(session.user_id)
    }
    reply(session:Session<K>,message:Element.Fragment,quote?:boolean){
        if(session.type!=='message') throw new Error(`not exist reply when type !=='message'`)
        message=[].concat(message)
        const replyElem:Element|undefined=quote?Element('reply',{message_id:session.message_id}):undefined
        if(replyElem) message.unshift(replyElem)
        return this.sendMsg(session.group_id||session.discuss_id||session.user_id,session.detail_type as Bot.MessageType,message)
    }
    async sendMsg(target_id:string|number,target_type:Bot.MessageType,message:Element.Fragment):Promise<Bot.MessageRet>{
        message=[].concat(message).map((item)=>{
            if(Element.isElement(item)) return item
            return Element('text',{text:String(item)})
        })
        const {message_id}=await this.callApi('sendMsg',target_id,target_type,message)
        const messageRet:Bot.MessageRet={
            message_id,
            from_id:this.self_id,
            to_id:target_id,
            type:target_type,
            elements:message as Element[]
        }
        this.adapter.emit(`message.send`,this.self_id,messageRet)
        return messageRet
    }
}
export interface Bot<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={},I extends object=object> extends Bot.Internal{
    self_id:string|number
    options:BotOptions<BO>
    adapter:Adapter<K,BO,AO>
    app:Zhin
    createSession<E extends keyof IcqqEventMap>(event: E, ...args: Parameters<IcqqEventMap[E]>): Session<'icqq', E>
    callApi<K extends keyof Bot.Internal>(apiName:K,...args:Bot.ApiParams<Bot.Internal[K]>):Promisify<Bot.ApiReturn<Bot.Internal[K]>>
    on<K extends keyof Bot.EventMap>(event:K,listener:Bot.EventMap[K])
    on<S extends string|symbol>(event:S & Exclude<keyof Bot.EventMap,S>,listener:(...args:any[])=>any)
    emit<K extends keyof Bot.EventMap>(event:K,...args:Parameters<Bot.EventMap[K]>)
    emit<S extends string|symbol>(event:S & Exclude<keyof Bot.EventMap,S>,...args:any[])
    // 会话发起者是否为群管理员
    isGroupAdmin?(session:Session<K>):boolean
    // 会话发起者是否为频道管理员
    isChannelAdmin?(session:Session<K>):boolean
    // 会话发起者是否为群主
    isGroupOwner?(session:Session<K>):boolean
    start():any
}
export type BotConstructors={
    [P in (keyof Zhin.Adapters)]:BotConstruct
}
export namespace Bot{
    export interface Methods{
        sendMsg(target_id:string|number,target_type:MessageType,message:Element.Fragment):Promise<{message_id:string}>
    }
    export interface Attrs{

    }
    export interface EventMap{
        message(message:any):any
        notice(notice:any):any
        request(request:any):any
        system(...args:any[]):any
    }
    export type ApiParams<T>=T extends (...args:infer R)=>any?R:never
    export type ApiReturn<T>=T extends (...args:any[])=>infer R?R:T
    export interface Internal extends Attrs,Methods{}
    export type MessageType='private'|'group'|'discuss'|'guild'
    export interface MessageRet{
        message_id:string
        from_id:string|number
        to_id:string|number
        type:MessageType
        elements:Element[]
    }
    export type FullTargetId=`${keyof Zhin.Adapters}:${string|number}:${string}:${string|number|`${string|number}:${string|number}`}`
    export function getFullTargetId(session:Session):FullTargetId{
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
    export const botConstructors:Partial<BotConstructors>={}
    export function define<K extends keyof Zhin.Adapters>(key: K, botConstruct: BotConstruct<K>) {
        botConstructors[key]=botConstruct
    }
}
export class BotList extends Array<Bot<keyof Zhin.Adapters,{},{}>>{
    get(self_id:string|number){
        return this.find(bot=>bot.self_id===self_id || bot.self_id===Number(self_id))
    }
}
export type BotConstruct<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={}>={
    new(app:Zhin, protocol:Adapter<K,BO,AO>, options:BotOptions<BO>):Zhin.Bots[K]
}
export namespace Bot{
    export const defaultOptions:BotOptions={
        quote_self:false,
        enable:true,
        enable_plugins:[],
        disable_plugins:[],
        admins:[]
    }
}