import {Adapter, AdapterOptions} from "@/adapter";
import {Config as OicqConfig, Client, MessageRet,Sendable as OicqSendable, Quotable, MessageElem} from "oicq";
import {Bot, BotOptions, SegmentElem, Sendable} from '@/bot'
import {App} from "@/app";
import {EventMap} from "oicq/lib/events";
import {Session} from "@/Session";
function toSegment(msgList:OicqSendable) {
    msgList = [].concat(msgList);
    return msgList.map(msg => {
        if(typeof msg==='string') return {type:'text',data:{text:msg}}
        const { type, ...other } = msg;
        return { type, data: other };
    });
}
function fromSegment(msgList:SegmentElem|(SegmentElem|string)[]) {
    msgList = [].concat(msgList);
    return msgList.map((msg) => {
        if(typeof msg==='string'){
            return {type: 'text',text:msg}
        }
        const { type, data, ...other } = msg;
        return { type:type.replace('mention','at'), ...other, ...data };
    }) as MessageElem[]
}
export interface OicqBotOptions extends OicqConfig{
    uin:number
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
    sendMsg(target_id: number, target_type: string, message:Sendable,quote?:Quotable) {
        const msg=typeof message==='string'?message:fromSegment(message)
        switch (target_type){
            case 'group':
                return this.sendGroupMsg(target_id,msg,quote)
            case 'private':
                return this.sendGroupMsg(target_id,msg,quote)
            case 'discuss':
                return this.sendDiscussMsg(target_id,msg,quote)
        }
    }
    createSession<E extends keyof OicqEventMap>(event:E,...args:Parameters<OicqEventMap[E]>):Session<'oicq', OicqEventMap, E>{
        const obj=typeof args[0]==="object"?args.shift():{}
        Object.assign(obj,{
            bot:this,
            platform:'oicq',
            adapter:this.adapter,
            event,
            message:event==='message'?toSegment(obj['message']):obj['message']
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
        return this.sendMsg(session['group_id']||session['discuss_id']||session['user_id'],session.message_type,message,session as any)
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
Adapter.define('oicq',OicqAdapter)
Bot.define('oicq',OicqBot)