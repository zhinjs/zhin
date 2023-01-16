import {App} from "@/app";
import {Adapter, Adapters} from "@/adapter";
import {OicqBot} from "@/adapters/oicq";
import Element from '@/element'
import {Session} from "@/session";
import {OneBot} from "@/adapters/onebot/bot";
import {qs} from '@/utils'

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
export namespace Segment{

    const mCQ = {
        "&#91;": "[",
        "&#93;": "]",
        "&amp;": "&",
    };
    function matchBracket(text, index, brackets = ["[", "]"]) {
        let stackSize = 0;
        if ("string" !== typeof text || text.length <= 2) {
            return -3;
        }
        if (0 > index || index > text.length - 1) {
            return -4;
        }
        if (!Array.isArray(brackets) || 2 !== brackets.length) {
            return -5;
        }
        for (const bracket of brackets) {
            if ("string" !== typeof bracket || 1 !== bracket.length) {
                return -5;
            }
        }
        const start = text[index];
        if (start !== brackets[0]) {
            return -1;
        }
        for (let i = index; i < text.length; ++i) {
            if (brackets[0] === text[i]) {
                ++stackSize;
            }
            if (brackets[1] === text[i]) {
                --stackSize;
            }
            if (0 === stackSize) {
                return i;
            }
        }
        return -2;
    }
    export function stringify(segments:Sendable){
        if(!Array.isArray(segments)) segments=[segments]
        return segments.map((seg)=>{
            if(typeof seg==='string' || typeof seg==='number') seg={type:'text',data:{text:String(seg)}}
            if(seg.type==='text') return seg.data['text']
            return `[SG:${seg.type},${Object.entries(seg.data).map(([k,v])=>`${k}=${v}`).join(',')}]`
        }).join('')
    }
    export function isSegment(content) :content is SegmentElem{
        if(!content || typeof content !=='object') return false
        return [
            'mention',
            'mention_all',
            'face','text',
            'image','voice',
            'reply','node',
            'file','audio',
            'location'].includes(content.type) && !content[Element.key]
    }
    export function parse(text:string):SegmentElem[]{
        const elems = [];
        const items = [];
        let itemsSize = 0;
        for (let i = 0; i < text.length; ++i) {
            const brackets = ["[", "]"];
            const pos = matchBracket(text, i, brackets);
            switch (pos) {
                case -1:
                    if (undefined === items[itemsSize]) {
                        items[itemsSize] = "";
                    }
                    items[itemsSize] += text[i];
                    continue;
                case -2:
                    throw `消息 SG 码不匹配：${text}`;
                case -3:
                case -4:
                    items.push(text);
                    i = text.length;
                    break;
                case -5:
                    // This is impossible
                    throw `错误的括号匹配：${brackets.join("")}`;
                default:
                    if (pos > 0) {
                        items.push(text.substring(i, pos + 1));
                        i = pos;
                        itemsSize = items.length;
                    }
            }
        }
        for (const c of items) {
            const s = c.replace(new RegExp(Object.keys(mCQ).join("|"), "g"), (s) => mCQ[s] || "");
            let cq = c.replace("[SG:", "type=");
            if ("string" === typeof s && "" !== s && !s.includes("[SG:")) {
                elems.push({ type: "text", data:{text: s} });
                continue;
            }
            cq = cq.substring(0, cq.length - 1);
            const {type,...data}=qs(cq)
            elems.push({type,data});
        }
        return elems;
    }
}
export class BotList<UT extends string|number> extends Array<Bot<keyof Adapters,{},{},UT>>{
    get(self_id:UT){
        return this.find(bot=>bot.self_id===self_id || bot.self_id===Number(self_id))
    }
}
export type BotConstruct<K extends keyof Bots=keyof Bots,BO={},AO={},UT extends string|number=string|number>={
    new(app:App, protocol:Adapter<K,BO,AO>, options:BotOptions<BO>):Bot<K,BO,AO,UT>
}