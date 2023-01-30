import {Adapter, AdapterOptions} from "@/adapter";
import {Config as IcqqConfig,EventMap, Client, MessageRet,Sendable as IcqqSendable, Quotable, MessageElem} from "icqq";
import {Bot, BotOptions, SegmentElem, Sendable} from '@/bot'
import {Zhin} from "@/zhin";
import {Session} from "@/Session";
function toSegment(msgList:IcqqSendable) {
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
export interface IcqqBotOptions extends IcqqConfig{
    uin:number
    quote_self?:boolean
    password?:string
}
export interface IcqqEventMap extends Zhin.BaseEventMap,EventMap{
}
export class IcqqBot extends Client implements Bot<'icqq',IcqqBotOptions,{},number>{
    public self_id:number
    constructor(public app:Zhin, public adapter:Adapter<'icqq',BotOptions<IcqqBotOptions>>, public options:BotOptions<IcqqBotOptions>) {
        if(!options.data_dir) options.data_dir=app.options.data_dir
        super(options)
        this.self_id=options.uin
    }
    trip<E extends keyof EventMap>(eventName: E, ...args:Parameters<EventMap[E]>): boolean {
        this.adapter.dispatch(eventName,this.createSession(eventName,...args))
        return super.trip(eventName,...args)
    }

    start(){
        this.login(this.options.uin,this.options.password)
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
    createSession<E extends keyof IcqqEventMap>(event:E,...args:Parameters<IcqqEventMap[E]>):Session<'icqq', E>{
        const obj=typeof args[0]==="object"?args.shift():{}
        Object.assign(obj,{
            bot:this,
            protocol:'icqq',
            adapter:this.adapter,
            event,
            detail_type:obj.message_type||obj.request_type||obj.system_type||obj.notice_type,
            segments:toSegment(obj['message']||[]),
        },{args})
        delete obj.reply
        return new Session<"icqq", E>(this.adapter,this.self_id,event,obj)
    }

    isAdmin(session: Session<'icqq','message'>): boolean {
        return this.options.admins && this.options.admins.includes(session['user_id']);
    }

    isMaster(session: Session<'icqq','message'>): boolean {
        return this.options.master===session['user_id'];
    }

    reply(session: Session, message: Sendable, quote?: boolean): Promise<MessageRet> {
        if(session.type!=='message') throw new Error(`not exist reply when post_type !=='message`)
        return this.sendMsg(Number(session.group_id||session.discuss_id||session.user_id),session.detail_type,message,quote?session:undefined)
    }
}
export class IcqqAdapter extends Adapter<'icqq',IcqqBotOptions,{},IcqqEventMap>{
    constructor(app:Zhin, protocol, options:AdapterOptions<IcqqBotOptions>) {
        super(app,protocol,options);
    }
    async start(){
        for(const botOptions of this.options.bots){
            this.startBot(botOptions)
        }
    }
}
Adapter.define('icqq',IcqqAdapter,IcqqBot)