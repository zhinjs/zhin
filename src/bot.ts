import {Zhin} from "./zhin";
import {Adapter} from "./adapter";
import Element from './element'
import {Session} from "./session";
import {qs} from './utils'
export type BotOptions<O={}>={
    quote_self?:boolean
    prefix?:string
    master?:string|number
    admins?:(string|number)[]
} & O
export interface Bot<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={},UT extends string|number=number>{
    self_id:UT
    options:BotOptions<BO>
    adapter:Adapter<K,BO,AO>
    app:Zhin
    get stat():{
        start_time:number
        lost_times:number
        recv_msg_cnt:number
        sent_msg_cnt:number
        msg_cnt_per_min:number
    }
    isMaster(session:Session):boolean
    isAdmin(session: Session):boolean
    start():any
    reply(session:Session,message:Sendable,quote?:boolean):Promise<any>
    sendMsg(target_id:UT,target_type:string,message:Sendable):any
}
export type BotConstructors={
    [P in (keyof Zhin.Adapters)]:BotConstruct
}
export namespace Bot{
    export type FullTargetId=`${keyof Zhin.Adapters}:${string|number}:${string}:${string|number}`
    export function getFullTargetId(session:Session):FullTargetId{
        return [
            session.adapter.protocol,
            session.bot.self_id,
            session.detail_type,
            session['guild_id'],
            session['channel_id'],
            session['group_id'],
            session['discuss_id'],
            session['user_id']
        ].filter(Boolean).join(':') as FullTargetId
    }
    export const botConstructors:Partial<BotConstructors>={}
    export function define<K extends keyof Zhin.Adapters, BO={},AO={}>(key: K, botConstruct: BotConstruct<K,BO,AO>) {
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
        message_id?:string
        user_id:string|number
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
    function factory<K extends keyof SegmentMap>(type:K,keyMap:{[P in keyof SegmentMap[K]]?:string}={}){
        return (obj?:string|number|Record<string, any>)=>{
            return {
                type,
                data:Object.fromEntries(Object.keys(keyMap).map(key=>{
                    return [key,obj && typeof obj==='object'?obj[keyMap[key]]:obj]
                }))
            } as SegmentElem<K>
        }
    }
    export const image=factory('image',{file_id:'file'})
    export const text=factory('text',{text:'text'})
    export const at=factory('mention',{user_id:'user_id'})
    export const face=factory('face',{id:'id'})
    export const reply=factory('reply',{message_id:'message_id'})
}
export class BotList<UT extends string|number> extends Array<Bot<keyof Zhin.Adapters,{},{},UT>>{
    get(self_id:UT){
        return this.find(bot=>bot.self_id===self_id || bot.self_id===Number(self_id))
    }
}
export type BotConstruct<K extends keyof Zhin.Bots=keyof Zhin.Bots,BO={},AO={},UT extends string|number=string|number>={
    new(app:Zhin, protocol:Adapter<K,BO,AO>, options:BotOptions<BO>):Bot<K,BO,AO,UT>
}