import {App} from "@/app";
import {Adapter, Adapters} from "@/adapter";
import {OicqBot} from "@/adapters/oicq";
import {Session} from "@/session";
import {OneBot} from "@/adapters/onebot/bot";

export type BotOptions<O={}>={
    quote_self?:boolean
    prefix?:string
    master?:string|number
    admins?:(string|number)[]
} & O
export interface Bot<K extends keyof Bots=keyof Bots,BO={},AO={},UT extends string|number=number>{
    self_id:UT
    startTime: number
    options:BotOptions<BO>
    adapter:Adapter<K,BO,AO>
    app:App
    isMaster(session:Session):boolean
    isAdmin(session: Session):boolean
    start():any
    reply(session:Session,message:Sendable,quote?:boolean):Promise<any>
    sendMsg(target_id:UT,target_type:string,message:Sendable):any
}
export interface Bots{
    onebot:OneBot
    oicq:OicqBot
}
export type BotConstructors={
    [P in (keyof Adapters)]:BotConstruct
}
export namespace Bot{
    export type FullTargetId=`${keyof Adapters}:${string|number}:${string}:${string|number}`
    export function getFullTargetId(session:Session):FullTargetId{
        return [
            session.adapter.protocol,
            session.bot.self_id,
            session.detail_type,
            session['guid_id'],
            session['channel_id'],
            session['group_id'],
            session['discuss_id'],
            session['user_id']
        ].filter(Boolean).join(':') as FullTargetId
    }
    export const botConstructors:Partial<BotConstructors>={}
    export function define<K extends keyof Adapters, BO={},AO={}>(key: K, botConstruct: BotConstruct<K,BO,AO>) {
        botConstructors[key]=botConstruct
    }
}
export interface SegmentMap{
    face:{id:number,text:string}
    text:{text:string}
    mention:{user_id:string}
    mention_all:null
    image:{file_id:string}
    voice:{ file_id:string }
    audio:{ file_id:string }
    file:{ file_id:string}
    location:{
        latitude:number
        longitude:number
        title:string
        content:string
    }
    reply:{
        message_id:string
        user_id:string
    }
}
export type SegmentElem<K extends keyof SegmentMap=keyof SegmentMap>={
    type:K
    data:SegmentMap[K]
}
export type Segment={
    [P in keyof SegmentMap]:(input:SegmentMap[P])=>SegmentElem<P>
}
export type Sendable=SegmentElem|string|number|(string|number|SegmentElem)[]
export class BotList<UT extends string|number> extends Array<Bot<keyof Adapters,{},{},UT>>{
    get(self_id:UT){
        return this.find(bot=>bot.self_id===self_id || bot.self_id===Number(self_id))
    }
}
export type BotConstruct<K extends keyof Bots=keyof Bots,BO={},AO={},UT extends string|number=string|number>={
    new(app:App, protocol:Adapter<K,BO,AO>, options:BotOptions<BO>):Bot<K,BO,AO,UT>
}