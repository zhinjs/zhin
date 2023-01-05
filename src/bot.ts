import {App} from "@/app";
import {Adapter, Adapters} from "@/adapter";
import {OicqBot} from "@/adapters/oicq";

export type BotOptions<O={}>={
    master?:string|number
    admins?:(string|number)[]
} & O
export interface Bot<K extends keyof Bots=keyof Bots,BO={},AO={},UT extends string|number=number>{
    self_id:UT
    startTime: number
    options:BotOptions<BO>
    adapter:Adapter<K,BO,AO>
    app:App
    start():any
    sendMsg(target_id:UT,target_type:string,message:Sendable):any
}

export interface Bots{
    oicq:OicqBot
}
export type BotConstructors={
    [P in (keyof Bots)]:BotConstruct
}
export namespace Bot{
    export const botConstructors:Partial<BotConstructors>={}
    export function define<K extends keyof BotConstructors, BO={},AO={}>(key: K, botConstruct: BotConstruct<K,BO,AO>) {
        botConstructors[key]=botConstruct
    }
}
export interface SegmentMap{
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
    [P in keyof SegmentMap]:(input:SegmentMap[P])=>SegmentElem
}
export type Sendable=Segment|string|(string|Segment)[]
export const segment:Segment={
    text:(data)=>({type:'text',data}),
    mention:(data)=>({type:'text',data}),
    mention_all:(data)=>({type:'text',data}),
    image:(data)=>({type:'text',data}),
    voice:(data)=>({type:'text',data}),
    audio:(data)=>({type:'text',data}),
    file:(data)=>({type:'text',data}),
    location:(data)=>({type:'text',data}),
    reply:(data)=>({type:'text',data}),
}
export class BotList<UT extends string|number> extends Array<Bot<keyof Adapters,{},{},UT>>{
    get(self_id:UT){
        return this.find(bot=>bot.self_id===self_id)
    }
}
export type BotConstruct<K extends keyof Bots=keyof Bots,BO={},AO={},UT extends string|number=number>={
    new(app:App, adapter:Adapter<K,BO,AO>, options:BotOptions<BO>):Bot<K,BO,AO,UT>
}