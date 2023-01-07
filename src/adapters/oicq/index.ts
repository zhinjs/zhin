import {Adapter, AdapterOptions} from "@/adapter";
import {Config as OicqConfig,EventMap, Client, MessageRet,Sendable as OicqSendable, Quotable, MessageElem} from "oicq";
import {Bot, BotOptions, SegmentElem, Sendable} from '@/bot'
import {App} from "@/app";
import {Session} from "@/Session";
function toSegment(msgList:OicqSendable) {
    msgList = [].concat(msgList);
    return msgList.map((msg) => {
        if (typeof msg === 'string') return {type: 'text', data: {text: msg}} as SegmentElem
        let {type, ...other} = msg;
        return {
            type:type==='at'?other['qq']?'mention':"mention_all":type,
            data: {
                ...other,
                user_id:other['qq']
            }
        }  as SegmentElem
    })
}
export function segmentsToString(segments:SegmentElem[]){
    return segments.map(segment=>{
        const toString=(obj:Record<string, any>)=>{
            return Object.keys(obj).map(key=>`${key}=${obj[key]}`).join(',')
        }
        return segment.type==='text'?segment.data['text']:`[SG:${segment.type} $${toString(segment.data)}]`
    }).join('')
}
function fromSegment(msgList:SegmentElem|string|number|(SegmentElem|string|number)[]) {
    msgList = [].concat(msgList);
    return msgList.map((msg) => {
        if(typeof msg !=='object') msg=String(msg)
        if(typeof msg==='string'){
            return {type: 'text',text:msg}
        }
        const { type, data, ...other } = msg;
        return {
            type: type.replace('mention','at').replace('at_all','at'),
            ...other,
            ...data
        };
    }) as MessageElem[]
}
export interface OicqBotOptions extends OicqConfig{
    uin:number
    quote_self?:boolean
    password?:string
}
export interface OicqEventMap extends App.BaseEventMap,EventMap{
}
export class OicqBot extends Client implements Bot<'oicq',OicqBotOptions,{},number>{
    public self_id:number
    public startTime:number
    constructor(public app:App, public adapter:Adapter<'oicq',BotOptions<OicqBotOptions>>, public options:BotOptions<OicqBotOptions>) {
        if(!options.data_dir) options.data_dir=app.options.data_dir
        super(options.uin,options)
        this.self_id=options.uin
    }
    emit<E extends keyof EventMap>(eventName: E, ...args:Parameters<EventMap[E]>): boolean {
        this.adapter.dispatch(eventName,this.createSession(eventName,...args))
        return super.emit(eventName,...args)
    }

    start(){
        this.login(this.options.password)
    }

    sendMsg(target_id: number, target_type: string, content:Sendable,session?:Session) {
        const msg=typeof content==='string'?content:fromSegment(content)
        const message:Quotable|undefined=session?{...session,message:fromSegment(session.segments)} as unknown as Quotable:undefined
        switch (target_type){
            case 'group':
                return this.sendGroupMsg(target_id,msg,message)
            case 'private':
                return this.sendPrivateMsg(target_id,msg,message)
            case 'discuss':
                return this.sendDiscussMsg(target_id,msg,message)
        }
    }
    createSession<E extends keyof OicqEventMap>(event:E,...args:Parameters<OicqEventMap[E]>):Session<'oicq', OicqEventMap, E>{
        const obj=typeof args[0]==="object"?args.shift():{}
        Object.assign(obj,{
            bot:this,
            platform:'oicq',
            adapter:this.adapter,
            event,
            segments:toSegment(obj['message']||[]),
        },{args})
        return new Session<"oicq", OicqEventMap, E>(this.adapter,this.self_id,event,obj)
    }

    isAdmin(session: Session<'oicq',OicqEventMap,'message'>): boolean {
        return this.options.admins && this.options.admins.includes(session['user_id']);
    }

    isMaster(session: Session<'oicq',OicqEventMap,'message'>): boolean {
        return this.options.master===session['user_id'];
    }

    reply(session: Session, message: Sendable, quote?: boolean): Promise<MessageRet> {
        if(session.post_type!=='message') throw new Error(`not exist reply when post_type !=='message`)
        return this.sendMsg(session['group_id']||session['discuss_id']||session['user_id'],session.message_type,message,session)
    }
}
export class OicqAdapter extends Adapter<'oicq',BotOptions<OicqBotOptions>,{},OicqEventMap>{
    constructor(app:App, platform, options:AdapterOptions<OicqBotOptions>) {
        super(app,platform,options);
    }
    async start(){
        for(const botOptions of this.options.bots){
            this.startBot(botOptions)
        }
    }
}
Adapter.define('oicq',OicqAdapter,OicqBot)